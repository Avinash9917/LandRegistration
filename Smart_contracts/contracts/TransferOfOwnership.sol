// SPDX-License-Identifier: MIT
pragma solidity >=0.4.22 <0.9.0;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./Properties.sol";
import "./LandRegistry.sol";

/**
 * @title TransferOwnerShip
 * @dev Manages land sales, purchase requests, escrow state transitions, and secure funds transfers.
 * Hardened with ReentrancyGuard, Pausable, and strict Checks-Effects-Interactions pattern.
 */
contract TransferOwnerShip is ReentrancyGuard, Pausable, Ownable {
    Property private immutable propertiesContract;
    LandRegistry private immutable landRegistryContract;

    enum SaleState {
        Active,
        AcceptedToABuyer,
        CancelSaleBySeller,
        Success,
        DeadlineOverForPayment,
        CancelAcceptanceRequestGivenBySeller,
        RejectedAcceptanceRequestByBuyer
    }

    enum RequestedUserToASaleState {
        SentPurchaseRequest,
        CancelPurchaseRequest,
        SellerAcceptedPurchaseRequest,
        SellerRejectedPurchaseRequest,
        SellerCanceledAcceptanceRequest,
        YouRejectedAcceptanceRequest,
        ReRequestedPurchaseRequest,
        SuccessfullyTransfered
    }

    struct RequestedUser {
        address user;
        uint256 priceOffered;
        RequestedUserToASaleState state;
    }

    struct Sales {
        uint256 saleId;
        address owner;
        uint256 price;
        uint256 propertyId;
        address acceptedFor;
        uint256 acceptedPrice;
        uint256 acceptedTime;
        uint256 deadlineForPayment;
        bool paymentDone;
        SaleState state;
    }

    Sales[] private sales;

    // Mappings
    mapping(address => uint256[]) private salesOfOwner;
    mapping(address => uint256[]) public requestedSales;
    mapping(uint256 => RequestedUser[]) private requestedUsers;
    mapping(uint256 => uint256[]) private propertiesOnSaleByLocation;

    // Escrow balances in case of multi-step escrow
    mapping(uint256 => uint256) public escrowBalances;

    // Events
    event PropertyOnSale(address indexed owner, uint256 indexed propertyId, uint256 saleId, uint256 price);
    event PurchaseRequestSent(uint256 indexed saleId, address indexed requestedUser, uint256 priceOffered);
    event SaleAccepted(uint256 indexed saleId, address indexed buyer, uint256 price, uint256 deadline);
    event SaleCompleted(uint256 indexed saleId, address indexed buyer, address indexed seller, uint256 price);
    event SaleCancelled(uint256 indexed saleId, address indexed seller);
    event RefundIssued(uint256 indexed saleId, address indexed buyer, uint256 amount);

    constructor(address _landRegistryContractAddress) {
        require(_landRegistryContractAddress != address(0), "Invalid registry address");
        landRegistryContract = LandRegistry(_landRegistryContractAddress);

        address propertiesContractAddress = landRegistryContract.getPropertiesContract();
        propertiesContract = Property(propertiesContractAddress);

        landRegistryContract.setTransferOwnershipContractAddress(address(this));
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function convertToWei(uint256 etherValue) public pure returns (uint256) {
        return etherValue * 1 ether;
    }

    // ==========================================
    // SALE LISTING & MANAGEMENT
    // ==========================================

    function addPropertyOnSale(
        uint256 _propertyId,
        uint256 _priceInEther
    ) external whenNotPaused {
        require(_priceInEther > 0, "Price must be greater than zero");

        Property.Land memory land = propertiesContract.getLandDetailsAsStruct(_propertyId);
        require(msg.sender == land.owner, "Only owner can put property on sale");
        require(land.state != Property.StateOfProperty.Disputed, "Cannot sell disputed property");
        require(!land.isEncumbered, "Cannot sell encumbered property");
        require(
            land.state == Property.StateOfProperty.Verified ||
            land.state == Property.StateOfProperty.Bought,
            "Property must be verified before selling"
        );

        uint256 priceInWei = convertToWei(_priceInEther);
        uint256 saleId = sales.length;

        Sales memory newSale = Sales({
            saleId: saleId,
            owner: msg.sender,
            price: priceInWei,
            propertyId: _propertyId,
            acceptedFor: address(0),
            acceptedPrice: 0,
            acceptedTime: 0,
            deadlineForPayment: 0,
            paymentDone: false,
            state: SaleState.Active
        });

        sales.push(newSale);
        salesOfOwner[msg.sender].push(saleId);
        propertiesOnSaleByLocation[land.locationId].push(saleId);

        propertiesContract.changeStateToOnSale(_propertyId, msg.sender);

        emit PropertyOnSale(msg.sender, _propertyId, saleId, priceInWei);
    }

    function getMySales(address _owner) external view returns (Sales[] memory) {
        uint256[] memory saleIds = salesOfOwner[_owner];
        Sales[] memory ownerSales = new Sales[](saleIds.length);

        for (uint256 i = 0; i < saleIds.length; i++) {
            ownerSales[i] = sales[saleIds[i]];
        }
        return ownerSales;
    }

    function getSalesByLocation(uint256 locationId) external view returns (Sales[] memory) {
        uint256[] memory saleIds = propertiesOnSaleByLocation[locationId];
        Sales[] memory locationSales = new Sales[](saleIds.length);

        for (uint256 i = 0; i < saleIds.length; i++) {
            locationSales[i] = sales[saleIds[i]];
        }
        return locationSales;
    }

    function getRequestedUsers(uint256 saleId) external view returns (RequestedUser[] memory) {
        return requestedUsers[saleId];
    }

    function getRequestedSales(address _buyer) external view returns (Sales[] memory) {
        uint256[] memory saleIds = requestedSales[_buyer];
        Sales[] memory myRequestedSales = new Sales[](saleIds.length);

        for (uint256 i = 0; i < saleIds.length; i++) {
            myRequestedSales[i] = sales[saleIds[i]];
        }
        return myRequestedSales;
    }

    function getAllSales() external view returns (Sales[] memory) {
        return sales;
    }

    function getAllActiveSales() external view returns (Sales[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < sales.length; i++) {
            if (sales[i].state == SaleState.Active || sales[i].state == SaleState.AcceptedToABuyer) {
                count++;
            }
        }

        Sales[] memory activeList = new Sales[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < sales.length; i++) {
            if (sales[i].state == SaleState.Active || sales[i].state == SaleState.AcceptedToABuyer) {
                activeList[idx] = sales[i];
                idx++;
            }
        }
        return activeList;
    }

    function getSalesCount() external view returns (uint256) {
        return sales.length;
    }

    function getStatusOfPurchaseRequest(uint256 _saleId) external view returns (RequestedUser memory) {
        for (uint256 i = 0; i < requestedUsers[_saleId].length; i++) {
            if (requestedUsers[_saleId][i].user == msg.sender) {
                return requestedUsers[_saleId][i];
            }
        }

        return RequestedUser({
            user: address(0),
            priceOffered: 0,
            state: RequestedUserToASaleState.SentPurchaseRequest
        });
    }

    // ==========================================
    // PURCHASE REQUESTS & NEGOTIATION
    // ==========================================

    function sendPurchaseRequest(uint256 _saleId, uint256 _priceOfferedInEther) external whenNotPaused {
        require(_saleId < sales.length, "Sale does not exist");
        Sales storage sale = sales[_saleId];
        require(sale.state == SaleState.Active, "Sale not active");
        require(_priceOfferedInEther > 0, "Price offered must be positive");
        require(msg.sender != sale.owner, "Owner cannot purchase own property");

        uint256 priceOfferedInWei = convertToWei(_priceOfferedInEther);

        requestedUsers[sale.saleId].push(
            RequestedUser({
                user: msg.sender,
                priceOffered: priceOfferedInWei,
                state: RequestedUserToASaleState.SentPurchaseRequest
            })
        );

        requestedSales[msg.sender].push(sale.saleId);
        emit PurchaseRequestSent(_saleId, msg.sender, priceOfferedInWei);
    }

    function acceptBuyerRequest(
        uint256 _saleId,
        address _buyer,
        uint256 _priceInEther
    ) external whenNotPaused {
        require(_saleId < sales.length, "Sale does not exist");
        Sales storage sale = sales[_saleId];
        require(sale.state == SaleState.Active, "Sale is not active");

        Property.Land memory land = propertiesContract.getLandDetailsAsStruct(sale.propertyId);
        require(msg.sender == land.owner, "Only owner can accept request");

        uint256 priceInWei = convertToWei(_priceInEther);
        bool buyerFound = false;
        uint256 buyerIndex = 0;

        for (uint256 i = 0; i < requestedUsers[sale.saleId].length; i++) {
            if (requestedUsers[sale.saleId][i].user == _buyer) {
                buyerFound = true;
                buyerIndex = i;
                break;
            }
        }
        require(buyerFound, "Buyer request not found");
        require(
            priceInWei == requestedUsers[sale.saleId][buyerIndex].priceOffered,
            "Price does not match buyer's offer"
        );

        sale.acceptedFor = _buyer;
        sale.acceptedPrice = priceInWei;
        sale.acceptedTime = block.timestamp;
        sale.deadlineForPayment = block.timestamp + 1 days; // 1 day window
        sale.state = SaleState.AcceptedToABuyer;

        requestedUsers[sale.saleId][buyerIndex].state = RequestedUserToASaleState.SellerAcceptedPurchaseRequest;

        emit SaleAccepted(_saleId, _buyer, priceInWei, sale.deadlineForPayment);
    }

    function cancelSaleBySeller(uint256 _saleId) external whenNotPaused returns (bool) {
        require(_saleId < sales.length, "Sale does not exist");
        Sales storage sale = sales[_saleId];

        require(sale.owner == msg.sender, "Only owner can cancel sale");
        require(!sale.paymentDone, "Payment already completed");
        require(sale.state != SaleState.Success, "Sale already succeeded");
        require(sale.state != SaleState.CancelSaleBySeller, "Sale already cancelled");
        require(sale.state != SaleState.AcceptedToABuyer, "Must cancel buyer acceptance first");

        sale.state = SaleState.CancelSaleBySeller;
        propertiesContract.changeStateBackToVerificed(sale.propertyId, msg.sender);

        emit SaleCancelled(_saleId, msg.sender);
        return true;
    }

    function reactivateSale(uint256 _saleId) external whenNotPaused {
        require(_saleId < sales.length, "Sale does not exist");
        Sales storage sale = sales[_saleId];

        require(sale.owner == msg.sender, "Only owner can reactivate");
        require(
            sale.state == SaleState.DeadlineOverForPayment ||
            sale.state == SaleState.CancelAcceptanceRequestGivenBySeller ||
            sale.state == SaleState.RejectedAcceptanceRequestByBuyer,
            "Cannot reactivate from current state"
        );

        sale.state = SaleState.Active;
        sale.acceptedFor = address(0);
        sale.acceptedPrice = 0;
        sale.acceptedTime = 0;
        sale.deadlineForPayment = 0;
        sale.paymentDone = false;
    }

    function rejectingAcceptanceRequestByBuyer(uint256 _saleId) external whenNotPaused {
        require(_saleId < sales.length, "Sale does not exist");
        Sales storage sale = sales[_saleId];

        require(
            sale.state == SaleState.AcceptedToABuyer ||
            (sale.state == SaleState.AcceptedToABuyer && block.timestamp > sale.deadlineForPayment),
            "State does not allow rejection"
        );
        require(sale.acceptedFor == msg.sender, "Not authorized");

        sale.state = SaleState.RejectedAcceptanceRequestByBuyer;

        for (uint256 i = 0; i < requestedUsers[sale.saleId].length; i++) {
            if (requestedUsers[sale.saleId][i].user == msg.sender) {
                requestedUsers[sale.saleId][i].state = RequestedUserToASaleState.YouRejectedAcceptanceRequest;
                break;
            }
        }
    }

    function rejectingAcceptanceRequestBySeller(uint256 _saleId) external whenNotPaused {
        require(_saleId < sales.length, "Sale does not exist");
        Sales storage sale = sales[_saleId];

        require(sale.state == SaleState.AcceptedToABuyer, "State does not allow cancellation");
        require(sale.owner == msg.sender, "Not authorized");

        address acceptedBuyer = sale.acceptedFor;
        sale.state = SaleState.CancelAcceptanceRequestGivenBySeller;
        sale.acceptedFor = address(0);
        sale.acceptedPrice = 0;
        sale.acceptedTime = 0;
        sale.deadlineForPayment = 0;

        for (uint256 i = 0; i < requestedUsers[sale.saleId].length; i++) {
            if (requestedUsers[sale.saleId][i].user == acceptedBuyer) {
                requestedUsers[sale.saleId][i].state = RequestedUserToASaleState.SellerCanceledAcceptanceRequest;
                break;
            }
        }
    }

    function cancelPurchaseRequestSentToSeller(uint256 _saleId) external whenNotPaused {
        require(_saleId < sales.length, "Sale does not exist");
        Sales storage sale = sales[_saleId];
        require(sale.state == SaleState.Active, "Sale not active");

        bool found = false;
        for (uint256 i = 0; i < requestedUsers[sale.saleId].length; i++) {
            if (requestedUsers[sale.saleId][i].user == msg.sender) {
                requestedUsers[sale.saleId][i].state = RequestedUserToASaleState.CancelPurchaseRequest;
                found = true;
                break;
            }
        }
        require(found, "No purchase request found");
    }

    function rejectPurchaseRequestOfBuyer(uint256 _saleId, address _buyer) external whenNotPaused {
        require(_saleId < sales.length, "Sale does not exist");
        Sales storage sale = sales[_saleId];

        require(sale.owner == msg.sender, "Only owner can reject");
        require(sale.state == SaleState.Active, "Sale not active");

        bool found = false;
        for (uint256 i = 0; i < requestedUsers[sale.saleId].length; i++) {
            if (requestedUsers[sale.saleId][i].user == _buyer) {
                requestedUsers[sale.saleId][i].state = RequestedUserToASaleState.SellerRejectedPurchaseRequest;
                found = true;
                break;
            }
        }
        require(found, "Buyer request not found");
    }

    function rerequestPurchaseRequest(uint256 _saleId, uint256 _priceOfferedInEther) external whenNotPaused {
        require(_saleId < sales.length, "Sale does not exist");
        Sales storage sale = sales[_saleId];
        require(sale.state == SaleState.Active, "Sale not active");
        require(_priceOfferedInEther > 0, "Price offered must be positive");

        bool found = false;
        for (uint256 i = 0; i < requestedUsers[sale.saleId].length; i++) {
            if (requestedUsers[sale.saleId][i].user == msg.sender) {
                requestedUsers[sale.saleId][i].state = RequestedUserToASaleState.ReRequestedPurchaseRequest;
                requestedUsers[sale.saleId][i].priceOffered = convertToWei(_priceOfferedInEther);
                found = true;
                break;
            }
        }
        require(found, "Buyer not in requested list");
        emit PurchaseRequestSent(_saleId, msg.sender, convertToWei(_priceOfferedInEther));
    }

    // ==========================================
    // ESCROW EXECUTION & PAYMENT SETTLEMENT
    // (REENTRANCY GUARDED & CHECKS-EFFECTS-INTERACTIONS)
    // ==========================================

    function transferOwnerShip(uint256 saleId) external payable nonReentrant whenNotPaused {
        require(saleId < sales.length, "Sale does not exist");
        Sales storage sale = sales[saleId];

        // 1. CHECKS
        require(sale.state == SaleState.AcceptedToABuyer, "Sale not in accepted state");
        require(msg.sender == sale.acceptedFor, "Only accepted buyer can pay");
        require(msg.value == sale.acceptedPrice, "Payment value must equal accepted price");
        require(block.timestamp <= sale.deadlineForPayment, "Payment deadline expired");
        require(!sale.paymentDone, "Payment already completed");

        // Verify property is not encumbered or disputed
        Property.Land memory land = propertiesContract.getLandDetailsAsStruct(sale.propertyId);
        require(!land.isEncumbered, "Cannot purchase encumbered land");
        require(land.state != Property.StateOfProperty.Disputed, "Cannot purchase disputed land");

        // Find buyer index
        bool buyerFound = false;
        uint256 buyerIdx = 0;
        for (uint256 i = 0; i < requestedUsers[sale.saleId].length; i++) {
            if (requestedUsers[sale.saleId][i].user == msg.sender) {
                buyerFound = true;
                buyerIdx = i;
                break;
            }
        }
        require(buyerFound, "Buyer not found in request list");

        // 2. EFFECTS (State mutations BEFORE external interactions)
        sale.paymentDone = true;
        sale.state = SaleState.Success;
        requestedUsers[sale.saleId][buyerIdx].state = RequestedUserToASaleState.SuccessfullyTransfered;

        // Clean up from location sale list
        uint256 locId = land.locationId;
        uint256[] storage propertiesOnSale = propertiesOnSaleByLocation[locId];
        for (uint256 i = 0; i < propertiesOnSale.length; i++) {
            if (propertiesOnSale[i] == sale.saleId) {
                propertiesOnSale[i] = propertiesOnSale[propertiesOnSale.length - 1];
                propertiesOnSale.pop();
                break;
            }
        }

        address seller = sale.owner;
        uint256 paymentAmount = msg.value;

        // 3. INTERACTIONS (External calls after internal effects)
        landRegistryContract.transferOwnership(sale.propertyId, msg.sender);

        (bool success, ) = payable(seller).call{value: paymentAmount}("");
        require(success, "ETH payment transfer to seller failed");

        emit SaleCompleted(saleId, msg.sender, seller, paymentAmount);
    }

    /**
     * @notice Claim refund in case escrowed funds were held or if deadline expired.
     */
    function claimRefund(uint256 saleId) external nonReentrant whenNotPaused {
        require(saleId < sales.length, "Sale does not exist");
        Sales storage sale = sales[saleId];

        if (sale.state == SaleState.AcceptedToABuyer && block.timestamp > sale.deadlineForPayment) {
            sale.state = SaleState.DeadlineOverForPayment;
        }

        uint256 refundAmount = escrowBalances[saleId];
        require(refundAmount > 0, "No refundable balance in escrow");
        require(msg.sender == sale.acceptedFor, "Only buyer can claim refund");

        escrowBalances[saleId] = 0;

        (bool sent, ) = payable(msg.sender).call{value: refundAmount}("");
        require(sent, "Refund transfer failed");

        emit RefundIssued(saleId, msg.sender, refundAmount);
    }

    function getSale(uint256 saleId) external view returns (Sales memory) {
        require(saleId < sales.length, "Sale does not exist");
        return sales[saleId];
    }
}