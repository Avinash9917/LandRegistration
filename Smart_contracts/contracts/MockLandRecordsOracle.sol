// SPDX-License-Identifier: MIT
pragma solidity >=0.4.22 <0.9.0;

import "./ILandRecordsOracle.sol";

/**
 * @title MockLandRecordsOracle
 * @dev Mock implementation of government land records registry for development and testing.
 */
contract MockLandRecordsOracle is ILandRecordsOracle {
    address public immutable admin;

    // mapping (surveyNumber => (revenueDeptId => registeredOwner))
    mapping(uint256 => mapping(uint256 => address)) public governmentRegistry;
    mapping(uint256 => mapping(uint256 => bool)) public blacklistRegistry;

    event RecordUpdated(uint256 indexed surveyNumber, uint256 indexed revenueDeptId, address indexed owner);

    constructor() {
        admin = msg.sender;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "MockOracle: caller is not admin");
        _;
    }

    function setGovernmentRecord(
        uint256 surveyNumber,
        uint256 revenueDeptId,
        address owner
    ) external onlyAdmin {
        governmentRegistry[surveyNumber][revenueDeptId] = owner;
        emit RecordUpdated(surveyNumber, revenueDeptId, owner);
    }

    function setBlacklistRecord(
        uint256 surveyNumber,
        uint256 revenueDeptId,
        bool isBlacklisted
    ) external onlyAdmin {
        blacklistRegistry[surveyNumber][revenueDeptId] = isBlacklisted;
    }

    function validateSurveyOwnership(
        uint256 surveyNumber,
        uint256 revenueDeptId,
        address claimant
    ) external view override returns (bool isValid, string memory message) {
        if (blacklistRegistry[surveyNumber][revenueDeptId]) {
            return (false, "Survey number is blacklisted or flagged for government dispute");
        }

        address recordedOwner = governmentRegistry[surveyNumber][revenueDeptId];
        // If not explicitly recorded in mock, allow default open validation for unassigned lands
        if (recordedOwner != address(0) && recordedOwner != claimant) {
            return (false, "Claimant does not match official government record owner");
        }

        return (true, "Valid");
    }
}
