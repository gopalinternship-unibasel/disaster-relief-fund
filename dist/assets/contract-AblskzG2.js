import{r as e}from"./rolldown-runtime-XKyaHtl9.js";import{C as t,g as n,i as r,m as i,p as a,w as o}from"./format-C7ICtifx.js";import{t as s}from"./title-CpLcw5V4.js";var c=e(o()),l=t(),u=/\b(pragma|solidity|contract|string|address|uint|bool|mapping|public|immutable|event|indexed|constructor|memory|require|function|external|payable|emit|return|true|false)\b/g;function d(e){let t=[],n=e.indexOf(`//`),r=(n>=0?e.slice(0,n):e).split(/("[^"]*")/);for(let e of r)if(/^"[^"]*"$/.test(e))t.push({cls:`tok-str`,text:e});else{let n=0;for(let r of e.matchAll(u))r.index>n&&t.push(e.slice(n,r.index)),t.push({cls:`tok-kw`,text:r[0]}),n=r.index+r[0].length;n<e.length&&t.push(e.slice(n))}return n>=0&&t.push({cls:`tok-com`,text:e.slice(n)}),t.map((e,t)=>typeof e==`string`?e:(0,l.jsx)(`span`,{className:e.cls,children:e.text},t))}function f(){s(`Contract source`);let[e,t]=(0,c.useState)(!1),o=i.replace(/\n$/,``).split(`
`);return(0,l.jsxs)(`div`,{className:`source`,children:[(0,l.jsxs)(`header`,{className:`source__head`,children:[(0,l.jsxs)(`div`,{children:[(0,l.jsx)(`h1`,{children:`Contract source`}),(0,l.jsxs)(`p`,{children:[`DisasterReliefFund.sol, `,o.length,` lines, as in the guide's appendix. This exact text is compiled into the contract this app deploys.`]})]}),(0,l.jsx)(`button`,{type:`button`,className:`btn btn--secondary`,onClick:async()=>{await r(`// SPDX-License-Identifier: MIT
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
`)&&(t(!0),window.setTimeout(()=>t(!1),1800))},children:e?`Copied`:`Copy the source`}),(0,l.jsx)(`span`,{className:`visually-hidden`,"aria-live":`polite`,children:e?`Copied to the clipboard`:``})]}),(0,l.jsxs)(`dl`,{className:`settings`,"aria-label":`Compiler settings and output`,children:[(0,l.jsxs)(`div`,{children:[(0,l.jsx)(`dt`,{children:`Compiler`}),(0,l.jsxs)(`dd`,{children:[`Solidity `,a.split(`+`)[0]]})]}),(0,l.jsxs)(`div`,{children:[(0,l.jsx)(`dt`,{children:`Optimizer`}),(0,l.jsx)(`dd`,{children:`On, 200 runs`})]}),(0,l.jsxs)(`div`,{children:[(0,l.jsx)(`dt`,{children:`EVM target`}),(0,l.jsx)(`dd`,{children:`Paris`})]}),(0,l.jsxs)(`div`,{children:[(0,l.jsx)(`dt`,{children:`Compilation through IR`}),(0,l.jsx)(`dd`,{children:`Off`})]}),(0,l.jsxs)(`div`,{children:[(0,l.jsx)(`dt`,{children:`Creation code`}),(0,l.jsxs)(`dd`,{className:`num`,children:[((n.length-2)/2).toLocaleString(`en-US`),` bytes`]})]})]}),(0,l.jsxs)(`p`,{className:`source__remix`,children:[`The guide has you type this contract yourselves in`,` `,(0,l.jsx)(`a`,{href:`https://app.remix.live`,target:`_blank`,rel:`noreferrer`,children:`Remix`}),` `,`in six stages; compare your own file with this text, and use the first four settings above in Remix's compiler.`]}),(0,l.jsx)(`pre`,{className:`code`,role:`region`,"aria-label":`Solidity source code`,tabIndex:0,children:(0,l.jsx)(`code`,{children:o.map((e,t)=>(0,l.jsxs)(`span`,{className:`code__line`,children:[(0,l.jsx)(`span`,{className:`code__n`,"aria-hidden":`true`,children:t+1}),(0,l.jsx)(`span`,{className:`code__t`,children:d(e)}),`
`]},t))})})]})}export{f as component};