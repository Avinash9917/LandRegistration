/**
 * Truffle configuration file with Multi-network (Ganache, Sepolia, Polygon/Base L2) support
 */

const path = require('path');
try {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
} catch (e) {
  // dotenv is optional in local test environments
}

module.exports = {
  networks: {
    development: {
      host: process.env.GANACHE_HOST || "127.0.0.1",
      port: process.env.GANACHE_PORT || 7545,
      network_id: "*",
      gas: 6721975,
      gasPrice: 20000000000
    },

    sepolia: {
      provider: () => {
        const HDWalletProvider = require('@truffle/hdwallet-provider');
        let privateKey = process.env.DEPLOYER_PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000001";
        if (!privateKey.startsWith("0x")) privateKey = "0x" + privateKey;
        const rpcUrl = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
        return new HDWalletProvider({
          privateKeys: [privateKey],
          providerOrUrl: rpcUrl
        });
      },
      network_id: 11155111,
      gas: 5500000,
      confirmations: 2,
      timeoutBlocks: 200,
      skipDryRun: true
    },

    polygon_amoy: {
      provider: () => {
        const HDWalletProvider = require('@truffle/hdwallet-provider');
        const privateKey = process.env.DEPLOYER_PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000001";
        const rpcUrl = process.env.POLYGON_RPC_URL || "https://rpc-amoy.polygon.technology";
        return new HDWalletProvider(privateKey, rpcUrl);
      },
      network_id: 80002,
      confirmations: 2,
      timeoutBlocks: 200,
      skipDryRun: true
    }
  },

  mocha: {
    timeout: 100000
  },

  compilers: {
    solc: {
      version: "0.8.18",
      settings: {
        optimizer: {
          enabled: true,
          runs: 200
        },
        viaIR: true
      }
    }
  }
};