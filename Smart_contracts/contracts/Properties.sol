// SPDX-License-Identifier: MIT
pragma solidity >=0.4.22 <0.9.0;

interface ILandRegistryRef {
    function transferOwnershipContractAddress() external view returns (address);
}

/**
 * @title Property
 * @dev Data contract for storing and managing land properties securely.
 * Controlled exclusively by LandRegistry and authorized TransferOwnerShip contracts.
 */
contract Property {
    enum StateOfProperty {
        Created,
        Scheduled,
        Verified,
        Rejected,
        OnSale,
        Bought,
        Disputed
    }

    struct Land {
        uint256 propertyId;
        uint256 locationId;
        uint256 revenueDepartmentId;
        uint256 surveyNumber;
        string locationName;
        string revenueDepartmentName;
        string surveyNumberName;
        address owner;
        uint256 area;
        uint256 price;
        uint256 registeredTime;
        address employeeId;
        string scheduledDate;
        string rejectedReason;
        StateOfProperty state;
        bytes32 documentHash;
        bool isEncumbered;
        string encumbranceDetails;
    }

    address public landRegistry;
    mapping(uint256 => Land) public lands;
    uint256 private landCount;

    modifier onlyAuthorized() {
        bool isAuthorized = (msg.sender == landRegistry);
        if (!isAuthorized && landRegistry != address(0)) {
            try ILandRegistryRef(landRegistry).transferOwnershipContractAddress() returns (address transferContract) {
                if (msg.sender == transferContract && transferContract != address(0)) {
                    isAuthorized = true;
                }
            } catch {}
        }
        require(isAuthorized, "Property: caller not authorized");
        _;
    }

    constructor() {
        landRegistry = msg.sender;
    }

    function setLandRegistry(address _landRegistry) external {
        require(msg.sender == landRegistry || landRegistry == address(0), "Property: unauthorized");
        require(_landRegistry != address(0), "Invalid address");
        landRegistry = _landRegistry;
    }

    function addLand(
        uint256 _locationId,
        uint256 _revenueDepartmentId,
        uint256 _surveyNumber,
        string memory _locationName,
        string memory _revenueDepartmentName,
        string memory _surveyNumberName,
        address _owner,
        uint256 _area,
        bytes32 _documentHash
    ) external onlyAuthorized returns (uint256) {
        require(_locationId > 0, "Invalid location ID: must be non-zero");
        require(_revenueDepartmentId > 0, "Invalid revenue department ID: must be non-zero");
        require(_surveyNumber > 0, "Invalid survey number: must be non-zero");
        require(_owner != address(0), "Invalid owner address");
        require(_area > 0, "Area must be greater than zero");
        require(bytes(_locationName).length > 0, "Location name cannot be empty");
        require(bytes(_revenueDepartmentName).length > 0, "Revenue dept name cannot be empty");
        require(bytes(_surveyNumberName).length > 0, "Survey number name cannot be empty");
        require(_documentHash != bytes32(0), "Document hash cannot be empty");

        landCount++;

        lands[landCount] = Land({
            propertyId: landCount,
            locationId: _locationId,
            revenueDepartmentId: _revenueDepartmentId,
            surveyNumber: _surveyNumber,
            locationName: _locationName,
            revenueDepartmentName: _revenueDepartmentName,
            surveyNumberName: _surveyNumberName,
            owner: _owner,
            area: _area,
            price: 0,
            registeredTime: block.timestamp,
            employeeId: address(0),
            scheduledDate: "",
            rejectedReason: "",
            state: StateOfProperty.Created,
            documentHash: _documentHash,
            isEncumbered: false,
            encumbranceDetails: ""
        });

        return landCount;
    }

    function getLandDetailsAsStruct(uint256 _propertyId) external view returns (Land memory) {
        require(lands[_propertyId].propertyId != 0, "Land does not exist");
        return lands[_propertyId];
    }

    function getLandCount() external view returns (uint256) {
        return landCount;
    }

    function changeStateToVerifed(uint256 _propertyId, address _employeeId) external onlyAuthorized {
        require(lands[_propertyId].propertyId != 0, "Land does not exist");
        lands[_propertyId].employeeId = _employeeId;
        lands[_propertyId].state = StateOfProperty.Verified;
    }

    function changeStateToRejected(
        uint256 _propertyId,
        address _employeeId,
        string memory _reason
    ) external onlyAuthorized {
        require(lands[_propertyId].propertyId != 0, "Land does not exist");
        lands[_propertyId].employeeId = _employeeId;
        lands[_propertyId].state = StateOfProperty.Rejected;
        lands[_propertyId].rejectedReason = _reason;
    }

    function changeStateToOnSale(uint256 _propertyId, address _owner) external onlyAuthorized {
        require(lands[_propertyId].propertyId != 0, "Land does not exist");
        require(lands[_propertyId].owner == _owner, "Only owner can put on sale");
        require(!lands[_propertyId].isEncumbered, "Property is encumbered");
        require(lands[_propertyId].state != StateOfProperty.Disputed, "Cannot sell disputed property");

        lands[_propertyId].state = StateOfProperty.OnSale;
    }

    function changeStateBackToVerificed(uint256 _propertyId, address _owner) external onlyAuthorized {
        require(lands[_propertyId].propertyId != 0, "Land does not exist");
        require(lands[_propertyId].owner == _owner, "Only owner can modify state");

        lands[_propertyId].state = StateOfProperty.Verified;
    }

    function updateOwner(uint256 _propertyId, address newOwner) external onlyAuthorized {
        require(lands[_propertyId].propertyId != 0, "Land does not exist");
        require(newOwner != address(0), "Invalid new owner");
        require(!lands[_propertyId].isEncumbered, "Property is encumbered");
        require(lands[_propertyId].state != StateOfProperty.Disputed, "Cannot transfer disputed property");

        lands[_propertyId].owner = newOwner;
        lands[_propertyId].state = StateOfProperty.Bought;
    }

    function setDocumentHash(uint256 _propertyId, bytes32 _documentHash) external onlyAuthorized {
        require(lands[_propertyId].propertyId != 0, "Land does not exist");
        require(_documentHash != bytes32(0), "Invalid document hash");
        lands[_propertyId].documentHash = _documentHash;
    }

    function disputeProperty(uint256 _propertyId, string memory _reason) external onlyAuthorized {
        require(lands[_propertyId].propertyId != 0, "Land does not exist");
        require(
            lands[_propertyId].state != StateOfProperty.Disputed,
            "Property already disputed"
        );

        lands[_propertyId].state = StateOfProperty.Disputed;
        lands[_propertyId].rejectedReason = _reason;
    }

    function resolveDispute(
        uint256 _propertyId,
        StateOfProperty _resolvedState,
        string memory _resolutionNote
    ) external onlyAuthorized {
        require(lands[_propertyId].propertyId != 0, "Land does not exist");
        require(lands[_propertyId].state == StateOfProperty.Disputed, "Property is not in dispute");

        lands[_propertyId].state = _resolvedState;
        lands[_propertyId].rejectedReason = _resolutionNote;
    }

    function setEncumbrance(
        uint256 _propertyId,
        bool _isEncumbered,
        string memory _details
    ) external onlyAuthorized {
        require(lands[_propertyId].propertyId != 0, "Land does not exist");
        lands[_propertyId].isEncumbered = _isEncumbered;
        lands[_propertyId].encumbranceDetails = _details;
    }
}