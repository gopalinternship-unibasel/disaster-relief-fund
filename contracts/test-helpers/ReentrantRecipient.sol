// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IReliefFund {
    function withdraw() external;
}

/// Test helper: a recipient contract that calls withdraw() a second time while it is being paid.
/// The second call must fail with "Nothing to withdraw", because the credit is cleared first.
contract ReentrantRecipient {
    address public fund;
    uint public timesPaid;
    bool public reentryFailed;
    string public reentryReason;

    function claim(address _fund) external {
        fund = _fund;
        IReliefFund(_fund).withdraw();
    }

    receive() external payable {
        timesPaid += 1;
        if (timesPaid == 1) {
            try IReliefFund(fund).withdraw() {
                reentryFailed = false;
            } catch Error(string memory reason) {
                reentryFailed = true;
                reentryReason = reason;
            }
        }
    }
}
