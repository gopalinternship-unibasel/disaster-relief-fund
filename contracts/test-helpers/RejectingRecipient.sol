// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IReliefFund {
    function withdraw() external;
}

/// Test helper: a recipient contract that refuses ETH until it is told to accept it.
/// Used to check that a failed payment restores the recipient's credit.
contract RejectingRecipient {
    bool public accepting;

    function setAccepting(bool value) external {
        accepting = value;
    }

    function claim(address fund) external {
        IReliefFund(fund).withdraw();
    }

    receive() external payable {
        require(accepting, "Recipient refuses ETH");
    }
}
