// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title IFoundationManage - FoundationManage 合约简化接口
 * @dev 仅保留外部依赖的函数
 */
interface IFoundationManage {
    function owner() external view returns (address);
    function meshToken() external view returns (address);
    function treasury() external view returns (address);
    function isReady() external view returns (bool);
    function autoTransferTo(address to, uint256 amount) external;
}

