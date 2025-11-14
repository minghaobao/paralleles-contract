// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title IMeshesTreasury - MeshesTreasury 合约简化接口
 * @dev 仅保留外部依赖的函数
 */
interface IMeshesTreasury {
    function owner() external view returns (address);
    function safeAddress() external view returns (address);
    function meshToken() external view returns (address);
    function foundationManage() external view returns (address);
    function isRecipientApproved(address to) external view returns (bool);
}

