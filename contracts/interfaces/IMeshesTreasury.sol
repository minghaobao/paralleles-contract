// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title IMeshesTreasury - MeshesTreasury 合约接口
 * @dev 用于其他合约调用 MeshesTreasury 的功能
 */
interface IMeshesTreasury {
    function owner() external view returns (address);
    function safeAddress() external view returns (address);
    function meshToken() external view returns (address);
    function foundationManage() external view returns (address);
    function autoBalanceEnabled() external view returns (bool);
    function balanceFoundationManage() external;
    function isRecipientApproved(address to) external view returns (bool);
    function isReady() external view returns (bool);
}


