// SPDX-License-Identifier: MIT
pragma solidity >=0.4.22 <0.9.0;

/**
 * @title Users
 * @dev Manages decentralized identity and user registrations with salted Aadhaar hash (zero plaintext PII on-chain).
 */
contract Users {
    struct User {
        address userID;
        string firstName;
        string lastName;
        string dateOfBirth;
        bytes32 aadharHash;
        uint256 accountCreatedDateTime;
    }

    mapping(address => bool) private registeredUsers;
    mapping(address => User) public users;
    mapping(bytes32 => bool) private aadharHashes;

    event UserRegistered(
        address indexed userID,
        bytes32 indexed aadharHash,
        uint256 accountCreatedDateTime
    );

    /**
     * @notice Register a new user on the platform.
     * @dev Plaintext Aadhaar is strictly forbidden on-chain. Caller provides a salted cryptographic hash.
     * @param _firstName First name
     * @param _lastName Last name
     * @param _dateOfBirth Date of birth (YYYY-MM-DD)
     * @param _aadharHash Keccak256 / SHA-256 salted hash of citizen Aadhaar ID
     */
    function registerUser(
        string memory _firstName,
        string memory _lastName,
        string memory _dateOfBirth,
        bytes32 _aadharHash
    ) public {
        require(!registeredUsers[msg.sender], "User already registered");
        require(_aadharHash != bytes32(0), "Invalid Aadhaar hash");
        require(!aadharHashes[_aadharHash], "Aadhar number already registered");
        require(bytes(_firstName).length > 0, "First name cannot be empty");
        require(bytes(_lastName).length > 0, "Last name cannot be empty");

        User memory newUser = User({
            userID: msg.sender,
            firstName: _firstName,
            lastName: _lastName,
            dateOfBirth: _dateOfBirth,
            aadharHash: _aadharHash,
            accountCreatedDateTime: block.timestamp
        });

        users[msg.sender] = newUser;
        registeredUsers[msg.sender] = true;
        aadharHashes[_aadharHash] = true;

        emit UserRegistered(msg.sender, _aadharHash, block.timestamp);
    }

    /**
     * @notice Check if a wallet address is registered.
     */
    function isUserRegistered(address _userId) public view returns (bool) {
        return registeredUsers[_userId];
    }

    /**
     * @notice Check if an Aadhaar hash is already registered.
     */
    function isAadharRegistered(bytes32 _aadharHash) public view returns (bool) {
        return aadharHashes[_aadharHash];
    }

    /**
     * @notice Fetch user details by wallet address.
     */
    function getUserDetails(
        address _userId
    )
        public
        view
        returns (
            string memory firstName,
            string memory lastName,
            string memory dateOfBirth,
            bytes32 aadharHash,
            uint256 accountCreatedDateTime
        )
    {
        require(users[_userId].userID != address(0), "User does not exist");

        User storage user = users[_userId];
        return (
            user.firstName,
            user.lastName,
            user.dateOfBirth,
            user.aadharHash,
            user.accountCreatedDateTime
        );
    }
}
