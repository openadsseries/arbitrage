// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { HypedArbitrageExecutorV4 } from "../src/HypedArbitrageExecutorV4.sol";

interface VmDeployV4 {
    function envAddress(string calldata name) external returns (address);
    function startBroadcast() external;
    function stopBroadcast() external;
}

contract DeployHypedArbitrageExecutorV4 {
    VmDeployV4 private constant vm =
        VmDeployV4(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant WETH = 0x4200000000000000000000000000000000000006;
    address private constant MINT_CLUB_BOND = 0xc5a076cad94176c2996B32d8466Be1cE757FAa27;
    address private constant ONCHAIN_ROUTER = 0xCa7a19BD1E260DCd92B17DdAc068C2bF67539a02;

    function run() external returns (HypedArbitrageExecutorV4 executor) {
        address trustedExecutor = vm.envAddress("ARBITRAGE_RELAYER_ADDRESS");
        address operatorManager = vm.envAddress("ARBITRAGE_V4_OPERATOR_MANAGER");

        require(trustedExecutor != operatorManager, "relay must not manage itself");

        vm.startBroadcast();
        executor = new HypedArbitrageExecutorV4(
            WETH, MINT_CLUB_BOND, ONCHAIN_ROUTER, trustedExecutor, operatorManager
        );
        vm.stopBroadcast();
    }
}
