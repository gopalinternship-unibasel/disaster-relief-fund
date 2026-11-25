// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

contract DisasterReliefFund {
    string public campaignName;
    address public immutable creator;
    address public immutable foodRecipient;
    address public immutable shelterRecipient;
    address public immutable medicalRecipient;
    uint public immutable foodPercent;
    uint public immutable shelterPercent;
    uint public immutable medicalPercent;
    uint public immutable endTime;
    uint public totalDonated;
    bool public allocated;
    mapping(address => uint) public pendingWithdrawals;

    event DonationReceived(address indexed donor, uint amount);
    event FundsAllocated(
        uint foodAmount,
        uint shelterAmount,
        uint medicalAmount
    );
    event FundsWithdrawn(address indexed recipient, uint amount);

    constructor(
        string memory _campaignName,
        address _foodRecipient,
        address _shelterRecipient,
        address _medicalRecipient,
        uint _durationMinutes,
        uint _foodPercent,
        uint _shelterPercent,
        uint _medicalPercent
    ) {
        require(_durationMinutes > 0, "Duration must be positive");
        require(
            _foodRecipient != address(0) &&
            _shelterRecipient != address(0) &&
            _medicalRecipient != address(0),
            "Zero recipient"
        );
        require(
            _foodRecipient != _shelterRecipient &&
            _foodRecipient != _medicalRecipient &&
            _shelterRecipient != _medicalRecipient,
            "Recipients must differ"
        );
        require(
            _foodPercent > 0 && _shelterPercent > 0 &&
            _medicalPercent > 0,
            "Percentages must be positive"
        );
        require(
            _foodPercent + _shelterPercent + _medicalPercent == 100,
            "Percentages must total 100"
        );
        campaignName = _campaignName;
        creator = msg.sender;
        foodRecipient = _foodRecipient;
        shelterRecipient = _shelterRecipient;
        medicalRecipient = _medicalRecipient;
        foodPercent = _foodPercent;
        shelterPercent = _shelterPercent;
        medicalPercent = _medicalPercent;
        endTime = block.timestamp + _durationMinutes * 1 minutes;
    }

    function donate() external payable {
        require(block.timestamp < endTime, "Fundraising ended");
        require(msg.value > 0, "Donation must be positive");

        totalDonated += msg.value;
        emit DonationReceived(msg.sender, msg.value);
    }

    function allocateFunds() external {
        require(block.timestamp >= endTime, "Fundraising still open");
        require(!allocated, "Already allocated");

        allocated = true;
        uint foodAmount = totalDonated * foodPercent / 100;
        uint shelterAmount = totalDonated * shelterPercent / 100;
        uint medicalAmount = totalDonated - foodAmount - shelterAmount;

        pendingWithdrawals[foodRecipient] = foodAmount;
        pendingWithdrawals[shelterRecipient] = shelterAmount;
        pendingWithdrawals[medicalRecipient] = medicalAmount;

        emit FundsAllocated(foodAmount, shelterAmount, medicalAmount);
    }

    function withdraw() external {
        require(allocated, "Funds not allocated");
        uint amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Nothing to withdraw");

        pendingWithdrawals[msg.sender] = 0;
        (bool sent, ) = payable(msg.sender).call{value: amount}("");
        require(sent, "ETH transfer failed");

        emit FundsWithdrawn(msg.sender, amount);
    }
}
