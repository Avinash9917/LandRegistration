// SPDX-License-Identifier: MIT
pragma solidity >=0.4.22 <0.9.0;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "./Properties.sol";
import "./ILandRecordsOracle.sol";

/**
 * @title LandRegistry
 * @dev Main controller contract for decentralized land registration with OpenZeppelin AccessControl,
 * jurisdiction mapping, pre-registration oracle verification, dispute management, and emergency pausability.
 */
contract LandRegistry is AccessControl, Pausable {
    bytes32 public constant OFFICER_ROLE = keccak256("OFFICER_ROLE");
    bytes32 public constant ADMIN_ROLE = DEFAULT_ADMIN_ROLE;

    Property public immutable propertiesContract;
    address public transferOwnershipContractAddress;
    bool private transferOwnershipContractAddressUpdated = false;
    address public oracleAddress;

    // Mapping owner -> property IDs
    mapping(address => uint256[]) private propertiesOfOwner;

    // Mapping revenue department ID -> property IDs
    mapping(uint256 => uint256[]) private propertiesControlledByRevenueDept;

    // Mapping revenue department ID -> assigned officer address
    mapping(uint256 => address) public revenueDeptIdToEmployee;

    // Mapping officer address -> assigned revenue department ID
    mapping(address => uint256) public employeeToRevenueDeptId;

    // Events
    event LandAdded(address indexed owner, uint256 indexed propertyId, bytes32 documentHash);
    event PropertyVerified(uint256 indexed propertyId, address indexed officer, uint256 revenueDeptId);
    event PropertyRejected(uint256 indexed propertyId, address indexed officer, string reason);
    event PropertyDisputed(uint256 indexed propertyId, address indexed disputant, string reason);
    event DisputeResolved(uint256 indexed propertyId, Property.StateOfProperty resolvedState, string note);
    event EncumbranceSet(uint256 indexed propertyId, bool isEncumbered, string details);
    event OfficerAssigned(uint256 indexed revenueDeptId, address indexed officer);

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OFFICER_ROLE, msg.sender);

        propertiesContract = new Property();
    }

    // ==========================================
    // ADMIN CONFIGURATION
    // ==========================================

    function setTransferOwnershipContractAddress(address contractAddress) external {
        require(contractAddress != address(0), "Invalid contract address");
        require(!transferOwnershipContractAddressUpdated, "Transfer contract already set");

        transferOwnershipContractAddress = contractAddress;
        transferOwnershipContractAddressUpdated = true;
    }

    function setOracleAddress(address _oracle) external onlyRole(ADMIN_ROLE) {
        oracleAddress = _oracle;
    }

    function mapRevenueDeptIdToEmployee(uint256 revenueDeptId, address employeeAddress) external onlyRole(ADMIN_ROLE) {
        require(revenueDeptId > 0, "Invalid revenue department ID");
        require(employeeAddress != address(0), "Invalid employee address");

        // Revoke role from old employee if exists
        address oldEmployee = revenueDeptIdToEmployee[revenueDeptId];
        if (oldEmployee != address(0) && oldEmployee != employeeAddress) {
            _revokeRole(OFFICER_ROLE, oldEmployee);
        }

        revenueDeptIdToEmployee[revenueDeptId] = employeeAddress;
        employeeToRevenueDeptId[employeeAddress] = revenueDeptId;
        _grantRole(OFFICER_ROLE, employeeAddress);

        emit OfficerAssigned(revenueDeptId, employeeAddress);
    }

    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    function pauseRegistry() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpauseRegistry() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    // ==========================================
    // LAND REGISTRATION & RETRIEVAL
    // ==========================================

    function addLand(
        uint256 _locationId,
        uint256 _revenueDepartmentId,
        uint256 _surveyNumber,
        string memory _locationName,
        string memory _revenueDepartmentName,
        string memory _surveyNumberName,
        uint256 _area,
        bytes32 _documentHash
    ) external whenNotPaused returns (uint256) {
        address _owner = msg.sender;

        require(_locationId > 0, "Invalid location ID: must be non-zero");
        require(_revenueDepartmentId > 0, "Invalid revenue department ID: must be non-zero");
        require(_surveyNumber > 0, "Invalid survey number: must be non-zero");
        require(_area > 0, "Area must be greater than zero");
        require(bytes(_locationName).length > 0, "Location name cannot be empty");
        require(bytes(_revenueDepartmentName).length > 0, "Revenue dept name cannot be empty");
        require(bytes(_surveyNumberName).length > 0, "Survey number name cannot be empty");
        require(_documentHash != bytes32(0), "Document hash cannot be empty");

        // Oracle pre-registration ownership validation
        if (oracleAddress != address(0)) {
            (bool isValid, string memory message) = ILandRecordsOracle(oracleAddress).validateSurveyOwnership(
                _surveyNumber,
                _revenueDepartmentId,
                _owner
            );
            require(isValid, message);
        }

        uint256 propertyId = propertiesContract.addLand(
            _locationId,
            _revenueDepartmentId,
            _surveyNumber,
            _locationName,
            _revenueDepartmentName,
            _surveyNumberName,
            _owner,
            _area,
            _documentHash
        );

        propertiesOfOwner[_owner].push(propertyId);
        propertiesControlledByRevenueDept[_revenueDepartmentId].push(propertyId);

        emit LandAdded(_owner, propertyId, _documentHash);
        return propertyId;
    }

    function getPropertyDetails(uint256 _propertyId) external view returns (Property.Land memory) {
        return propertiesContract.getLandDetailsAsStruct(_propertyId);
    }

    function getPropertiesOfOwner(address _owner) external view returns (Property.Land[] memory) {
        uint256[] memory propertyIds = propertiesOfOwner[_owner];
        Property.Land[] memory properties = new Property.Land[](propertyIds.length);

        for (uint256 i = 0; i < propertyIds.length; i++) {
            properties[i] = propertiesContract.getLandDetailsAsStruct(propertyIds[i]);
        }
        return properties;
    }

    function getAllProperties() external view returns (Property.Land[] memory) {
        uint256 count = propertiesContract.getLandCount();
        Property.Land[] memory properties = new Property.Land[](count);
        for (uint256 i = 1; i <= count; i++) {
            properties[i - 1] = propertiesContract.getLandDetailsAsStruct(i);
        }
        return properties;
    }

    function getPropertiesByRevenueDeptId(uint256 _revenueDeptId) external view returns (Property.Land[] memory) {
        uint256[] memory propertyIds = propertiesControlledByRevenueDept[_revenueDeptId];
        Property.Land[] memory properties = new Property.Land[](propertyIds.length);

        for (uint256 i = 0; i < propertyIds.length; i++) {
            properties[i] = propertiesContract.getLandDetailsAsStruct(propertyIds[i]);
        }
        return properties;
    }

    function getRevenueDeptId(uint256 propertyId) public view returns (uint256) {
        return propertiesContract.getLandDetailsAsStruct(propertyId).revenueDepartmentId;
    }

    // ==========================================
    // OFFICER JURISDICTION & VERIFICATION
    // ==========================================

    function verifyProperty(uint256 _propertyId) external whenNotPaused {
        require(
            hasRole(OFFICER_ROLE, msg.sender) || hasRole(ADMIN_ROLE, msg.sender),
            "Caller is not an authorized officer"
        );
        require(
            hasRole(DEFAULT_ADMIN_ROLE, msg.sender) ||
            employeeToRevenueDeptId[msg.sender] == getRevenueDeptId(_propertyId) ||
            employeeToRevenueDeptId[msg.sender] == 0,
            "Officer jurisdiction mismatch"
        );

        propertiesContract.changeStateToVerifed(_propertyId, msg.sender);
        uint256 deptId = getRevenueDeptId(_propertyId);
        emit PropertyVerified(_propertyId, msg.sender, deptId);
    }

    function rejectProperty(uint256 _propertyId, string memory _reason) external whenNotPaused {
        require(
            hasRole(OFFICER_ROLE, msg.sender) || hasRole(ADMIN_ROLE, msg.sender),
            "Caller is not an authorized officer"
        );
        require(
            hasRole(DEFAULT_ADMIN_ROLE, msg.sender) ||
            employeeToRevenueDeptId[msg.sender] == getRevenueDeptId(_propertyId) ||
            employeeToRevenueDeptId[msg.sender] == 0,
            "Officer jurisdiction mismatch"
        );
        require(bytes(_reason).length > 0, "Rejection reason required");

        propertiesContract.changeStateToRejected(_propertyId, msg.sender, _reason);
        emit PropertyRejected(_propertyId, msg.sender, _reason);
    }

    // ==========================================
    // DISPUTE & ENCUMBRANCE MANAGEMENT
    // ==========================================

    function disputeProperty(uint256 _propertyId, string memory _reason) external whenNotPaused {
        require(bytes(_reason).length > 0, "Dispute reason required");
        propertiesContract.disputeProperty(_propertyId, _reason);
        emit PropertyDisputed(_propertyId, msg.sender, _reason);
    }

    function resolveDispute(
        uint256 _propertyId,
        Property.StateOfProperty _resolvedState,
        string memory _resolutionNote
    ) external whenNotPaused {
        require(
            hasRole(ADMIN_ROLE, msg.sender) || hasRole(OFFICER_ROLE, msg.sender),
            "Only authorized officer or admin can resolve disputes"
        );

        propertiesContract.resolveDispute(_propertyId, _resolvedState, _resolutionNote);
        emit DisputeResolved(_propertyId, _resolvedState, _resolutionNote);
    }

    function setEncumbrance(
        uint256 _propertyId,
        bool _isEncumbered,
        string memory _details
    ) external whenNotPaused {
        require(
            hasRole(ADMIN_ROLE, msg.sender) || hasRole(OFFICER_ROLE, msg.sender),
            "Only authorized officer or admin can manage encumbrances"
        );

        propertiesContract.setEncumbrance(_propertyId, _isEncumbered, _details);
        emit EncumbranceSet(_propertyId, _isEncumbered, _details);
    }

    // ==========================================
    // OWNERSHIP TRANSFER (CALLED BY TRANSFER CONTRACT)
    // ==========================================

    function transferOwnership(uint256 _propertyId, address newOwner) external whenNotPaused {
        require(
            msg.sender == transferOwnershipContractAddress,
            "Only TransferOfOwnership contract allowed"
        );

        address oldOwner = propertiesContract.getLandDetailsAsStruct(_propertyId).owner;

        // Remove property from old owner's list
        uint256[] storage propertiesOfOldOwner = propertiesOfOwner[oldOwner];
        for (uint256 i = 0; i < propertiesOfOldOwner.length; i++) {
            if (propertiesOfOldOwner[i] == _propertyId) {
                propertiesOfOldOwner[i] = propertiesOfOldOwner[propertiesOfOldOwner.length - 1];
                propertiesOfOldOwner.pop();
                break;
            }
        }

        // Add property to new owner's list
        propertiesOfOwner[newOwner].push(_propertyId);
        propertiesContract.updateOwner(_propertyId, newOwner);
    }

    function getPropertiesContract() external view returns (address) {
        return address(propertiesContract);
    }
}