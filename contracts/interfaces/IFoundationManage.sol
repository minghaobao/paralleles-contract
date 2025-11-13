// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title IFoundationManage - FoundationManage 合约接口
 * @dev 用于其他合约调用 FoundationManage 的功能
 */
interface IFoundationManage {
    function owner() external view returns (address);
    function pause() external;
    function unpause() external;
    function emergencyWithdrawToTreasury(uint256 amount) external;
    function meshToken() external view returns (address);
    function treasury() external view returns (address);
    function isReady() external view returns (bool);
}


