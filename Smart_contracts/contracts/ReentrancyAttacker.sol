// SPDX-License-Identifier: MIT
pragma solidity >=0.4.22 <0.9.0;

import "./TransferOfOwnership.sol";

/**
 * @title ReentrancyAttacker
 * @dev Contract simulating malicious reentrancy attempts.
 */
contract ReentrancyAttacker {
    TransferOwnerShip public immutable targetContract;
    uint256 public targetSaleId;
    uint256 public attackCount;
    bool public attacking;

    constructor(address payable _target) {
        targetContract = TransferOwnerShip(_target);
    }

    function sendPurchaseRequest(uint256 _saleId, uint256 _priceInEther) external {
        targetContract.sendPurchaseRequest(_saleId, _priceInEther);
    }

    // Fallback if receiving funds
    receive() external payable {
        if (attacking && attackCount < 2) {
            attackCount++;
            targetContract.transferOwnerShip{value: msg.value}(targetSaleId);
        }
    }

    function attack(uint256 _saleId) external payable {
        targetSaleId = _saleId;
        attacking = true;
        attackCount = 0;
        targetContract.transferOwnerShip{value: msg.value}(_saleId);
    }
}
