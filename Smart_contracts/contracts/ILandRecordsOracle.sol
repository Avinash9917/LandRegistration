// SPDX-License-Identifier: MIT
pragma solidity >=0.4.22 <0.9.0;

/**
 * @title ILandRecordsOracle
 * @dev Interface for external government land records registry (e.g. Bhoomi, Dharani).
 * Validates survey number ownership before on-chain registration.
 */
interface ILandRecordsOracle {
    function validateSurveyOwnership(
        uint256 surveyNumber,
        uint256 revenueDeptId,
        address claimant
    ) external view returns (bool isValid, string memory message);
}
