import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { encodeDeployData, getAddress, isAddress } from "viem";

const HOST = "127.0.0.1";
const PORT = 9546;
const BASE_CHAIN_ID = "0x2105";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const protocol = {
  weth: "0x4200000000000000000000000000000000000006",
  mintClubBond: "0xc5a076cad94176c2996B32d8466Be1cE757FAa27",
  onchainRouter: "0xCa7a19BD1E260DCd92B17DdAc068C2bF67539a02",
};

function envAddress(name) {
  const value = process.env[name];
  if (!value || !isAddress(value)) throw new Error(`${name} must be a valid public address.`);
  return getAddress(value);
}

const roles = {
  deployer: envAddress("ARBITRAGE_DEPLOYER_ADDRESS"),
  relay: envAddress("ARBITRAGE_RELAYER_ADDRESS"),
  manager: envAddress("ARBITRAGE_V4_OPERATOR_MANAGER"),
};

if (roles.relay === roles.manager) {
  throw new Error("Relay and manager must use separate addresses.");
}

const artifactPath = resolve(ROOT, "out/HypedArbitrageExecutorV4.sol/HypedArbitrageExecutorV4.json");
const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
const deployData = encodeDeployData({
  abi: artifact.abi,
  bytecode: artifact.bytecode.object,
  args: [
    protocol.weth,
    protocol.mintClubBond,
    protocol.onchainRouter,
    roles.relay,
    roles.manager,
  ],
});
const pageData = JSON.stringify({ roles, deployData, chainId: BASE_CHAIN_ID });

function html() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>GETHYPED V4 deployment</title>
  <style>
    :root { color-scheme: dark; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #07100c; color: #e6eee9; }
    main { width: min(680px, calc(100vw - 32px)); border: 1px solid #244135; background: #0b1511; padding: 28px; }
    h1 { margin: 0 0 8px; font: 600 24px/1.2 ui-sans-serif, system-ui, sans-serif; }
    p { color: #9aaba3; line-height: 1.5; }
    dl { margin: 24px 0; border-top: 1px solid #20362d; }
    .row { display: grid; grid-template-columns: 112px minmax(0, 1fr); gap: 16px; padding: 13px 0; border-bottom: 1px solid #20362d; }
    dt { color: #809188; } dd { margin: 0; overflow-wrap: anywhere; }
    button { width: 100%; min-height: 48px; border: 0; background: #48bd8d; color: #04110b; font: 700 14px/1 ui-monospace, monospace; cursor: pointer; }
    button:disabled { cursor: not-allowed; opacity: .45; }
    #status { min-height: 48px; margin: 16px 0 0; padding: 14px; border: 1px solid #20362d; color: #b5c2bc; overflow-wrap: anywhere; }
    .error { border-color: #7e3e38 !important; color: #ffaca2 !important; }
    .success { border-color: #2f8f69 !important; color: #60d8a5 !important; }
    small { display: block; margin-top: 16px; color: #708078; line-height: 1.5; }
  </style>
</head>
<body>
  <main>
    <h1>Deploy V4 to Base</h1>
    <p>Review the network and public roles. Nothing is sent until you press the final deploy button and approve it in OKX Wallet.</p>
    <dl>
      <div class="row"><dt>Network</dt><dd>Base mainnet (8453)</dd></div>
      <div class="row"><dt>Deployer</dt><dd>${roles.deployer}</dd></div>
      <div class="row"><dt>Relay</dt><dd>${roles.relay}</dd></div>
      <div class="row"><dt>Manager</dt><dd>${roles.manager}</dd></div>
      <div class="row"><dt>Estimated cost</dt><dd id="cost">Connect OKX Wallet to estimate</dd></div>
    </dl>
    <button id="action">Connect OKX Wallet</button>
    <div id="status">No transaction has been sent.</div>
    <small>This local page cannot access private keys. OKX Wallet signs and broadcasts the contract deployment directly.</small>
  </main>
  <script>
    const CONFIG = ${pageData};
    const action = document.querySelector('#action');
    const status = document.querySelector('#status');
    const cost = document.querySelector('#cost');
    let provider;
    let account;
    let gas;

    function setStatus(message, kind = '') { status.textContent = message; status.className = kind; }
    function toHex(value) { return '0x' + value.toString(16); }
    function formatEth(value) {
      const whole = value / 1000000000000000000n;
      const fraction = (value % 1000000000000000000n).toString().padStart(18, '0').slice(0, 8);
      return whole + '.' + fraction + ' ETH';
    }
    function findOkxProvider() {
      if (window.okxwallet) return window.okxwallet;
      const injected = window.ethereum;
      if (injected?.providers) return injected.providers.find((item) => item.isOkxWallet);
      if (injected?.isOkxWallet) return injected;
      return null;
    }

    async function connect() {
      provider = findOkxProvider();
      if (!provider) throw new Error('OKX Wallet is not enabled in this browser.');
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      account = accounts?.[0];
      if (!account || account.toLowerCase() !== CONFIG.roles.deployer.toLowerCase()) {
        throw new Error('Select the deployment account: ' + CONFIG.roles.deployer);
      }
      let chainId = await provider.request({ method: 'eth_chainId' });
      if (chainId !== CONFIG.chainId) {
        await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CONFIG.chainId }] });
        chainId = await provider.request({ method: 'eth_chainId' });
      }
      if (chainId !== CONFIG.chainId) throw new Error('Switch OKX Wallet to Base mainnet.');
      const gasEstimate = BigInt(await provider.request({
        method: 'eth_estimateGas',
        params: [{ from: account, data: CONFIG.deployData }],
      }));
      gas = gasEstimate * 12n / 10n;
      const gasPrice = BigInt(await provider.request({ method: 'eth_gasPrice' }));
      const balance = BigInt(await provider.request({ method: 'eth_getBalance', params: [account, 'latest'] }));
      const estimate = gas * gasPrice;
      cost.textContent = 'Up to ' + formatEth(estimate);
      if (balance < estimate) throw new Error('The deployment account needs more Base ETH.');
      action.textContent = 'Deploy V4';
      setStatus('Ready. Review the roles above, then deploy.');
      action.onclick = deploy;
    }

    async function deploy() {
      action.disabled = true;
      try {
        setStatus('Waiting for approval in OKX Wallet.');
        const hash = await provider.request({
          method: 'eth_sendTransaction',
          params: [{ from: account, data: CONFIG.deployData, gas: toHex(gas) }],
        });
        setStatus('Transaction sent. Waiting for Base confirmation: ' + hash);
        let receipt;
        while (!receipt) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          receipt = await provider.request({ method: 'eth_getTransactionReceipt', params: [hash] });
        }
        if (receipt.status !== '0x1' || !receipt.contractAddress) throw new Error('Base rejected the deployment transaction.');
        setStatus('V4 deployed: ' + receipt.contractAddress, 'success');
        await fetch('/result', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ hash, contractAddress: receipt.contractAddress, blockNumber: receipt.blockNumber }),
        });
        action.textContent = 'Deployment confirmed';
      } catch (error) {
        setStatus(error?.message || 'Deployment failed.', 'error');
        action.disabled = false;
      }
    }

    action.onclick = async () => {
      action.disabled = true;
      try { await connect(); }
      catch (error) { setStatus(error?.message || 'Could not connect OKX Wallet.', 'error'); }
      finally { action.disabled = false; }
    };
  </script>
</body>
</html>`;
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/") {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
    });
    response.end(html());
    return;
  }
  if (request.method === "POST" && request.url === "/result") {
    let body = "";
    for await (const chunk of request) body += chunk;
    console.log("V4 deployment confirmed:", JSON.parse(body));
    response.writeHead(204);
    response.end();
    return;
  }
  response.writeHead(404);
  response.end("Not found");
});

server.listen(PORT, HOST, () => console.log(`V4 deployment review: http://${HOST}:${PORT}`));
