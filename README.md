# Charon

## A bridge between Stellar and other blockchains

This is a proof of concept for Charon, a proposal to bridge from Stellar to
other blockchains, starting with Solana.

## XLM to wXLM

This proof of concept focusses on bridging assets from Stellar to Solana.

* You may use the <a href="https://laboratory.stellar.org/">Stellar
  Laboratory</a> to check results in Stellar. This proof of concept uses Horizon
  testnet.
* You may use <a href="https://explorer.solana.com/">Solana Explorer</a> to
  check results in Solana. This proof of concept uses a local solana instance.
* `poc` contains the main Proof of Concept (
  see [the PoC tests](poc/tests/poc.test.ts) for an overview)
* `poc-solana-program` contains a proof of concept for creating a solana program
  that acts as a vault and a mint, it is incomplete.
