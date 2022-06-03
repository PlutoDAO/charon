// noinspection DuplicatedCode
import * as web3 from '@solana/web3.js'
import {LAMPORTS_PER_SOL, sendAndConfirmRawTransaction} from '@solana/web3.js'
import {
    Asset,
    BASE_FEE,
    Horizon,
    Keypair,
    Server,
    Transaction,
    TransactionBuilder
} from 'stellar-sdk'
import {Controller, User, Validator} from '../src/domain'
import {BridgeService} from '../src/service/bridge.service'
import { getOrCreateAssociatedTokenAccount } from '@solana/spl-token'
import TransactionResponse = Horizon.TransactionResponse

jest.setTimeout(30000000)

const server = new Server(process.env.HORIZON_URL)
const connection = new web3.Connection(process.env.SOLANA_CLUSTER_URL, 'confirmed')

type CompatibleKeyPair = Keypair | web3.Keypair

async function fundAccount(keyPairToFund: CompatibleKeyPair, chain: 'stellar' | 'solana'): Promise<void> {
    if (chain === 'stellar') {
        try {
            // @ts-ignore
            await server.friendbot(keyPairToFund.publicKey()).call()
        } catch (e) {
            console.error(e)
        }
    } else {
        // @ts-ignore
        const airdropTxSignature = await connection.requestAirdrop(keyPairToFund.publicKey, LAMPORTS_PER_SOL)
        await connection.confirmTransaction(airdropTxSignature)
    }
}

describe('Charon', () => {
    describe('Mint setup', () => {
        it("should create a solana mint and store it in the ControllerConfig's account data", async () => {
            try {
                const stellarControllerKeyPair = Keypair.random()
                const stellarControllerConfigKeyPair = Keypair.random()
                const solanaControllerKeyPair = web3.Keypair.generate()

                await fundAccount(stellarControllerKeyPair, 'stellar')
                await fundAccount(stellarControllerConfigKeyPair, 'stellar')
                await fundAccount(solanaControllerKeyPair, 'solana')

                const bridgeService = new BridgeService(
                    server,
                    connection,
                    stellarControllerKeyPair,
                    stellarControllerConfigKeyPair,
                    solanaControllerKeyPair
                )

                const XLM = Asset.native()
                const result = await bridgeService.createSolanaMint(XLM)
                const account = await server.loadAccount(bridgeService.stellarControllerConfigKeyPair.publicKey())
                const accountDataMintAddress = Buffer.from(
                    account.data_attr[Controller.getSolanaMintAttributeName(XLM)],
                    'base64'
                ).toString('utf8')
                expect(accountDataMintAddress).toBe(result.mintAddress)
            } catch (e) {
                console.error(e)
                throw e
            }
        })
    })

    describe('E2E Scenario', () => {
        it('Should bridge XLM to wXLM', async () => {
            try {
                // Setup and fund accounts
                const stellarControllerKeyPair = Keypair.random()
                const stellarControllerConfigKeyPair = Keypair.random()
                const solanaControllerKeyPair = web3.Keypair.generate()

                await fundAccount(stellarControllerKeyPair, 'stellar')
                await fundAccount(stellarControllerConfigKeyPair, 'stellar')
                await fundAccount(solanaControllerKeyPair, 'solana')

                const firstValidatorStellarKeyPair = Keypair.random()
                const firstValidatorSolanaKeyPair = web3.Keypair.generate()
                const secondValidatorStellarKeyPair = Keypair.random()
                const secondValidatorSolanaKeyPair = web3.Keypair.generate()

                await fundAccount(firstValidatorStellarKeyPair, 'stellar')
                await fundAccount(firstValidatorSolanaKeyPair, 'solana')
                await fundAccount(secondValidatorStellarKeyPair, 'stellar')
                await fundAccount(secondValidatorSolanaKeyPair, 'solana')

                const userStellarKeyPair = Keypair.random()
                const userSolanaKeyPair = web3.Keypair.generate()
                const user = new User(userStellarKeyPair.publicKey(), userSolanaKeyPair.publicKey.toBase58())
                console.log('user', user)

                await fundAccount(userStellarKeyPair, 'stellar')
                await fundAccount(userSolanaKeyPair, 'solana')

                const bridgeService = new BridgeService(
                    server,
                    connection,
                    stellarControllerKeyPair,
                    stellarControllerConfigKeyPair,
                    solanaControllerKeyPair
                )

                // Create mint (Stellar+Solana)
                const XLM = Asset.native()
                const mintResult = await bridgeService.createSolanaMint(XLM)

                //Add first validator to Vault (Stellar)
                const validator = new Validator(
                    firstValidatorStellarKeyPair.publicKey(),
                    firstValidatorSolanaKeyPair.publicKey.toBase58()
                )
                const intent = await bridgeService.getAddValidatorToVaultIntent(validator)
                const tx = TransactionBuilder.fromXDR(intent.transactionXdr, process.env.HORIZON_NETWORK_PASSPHRASE)

                tx.sign(firstValidatorStellarKeyPair)
                await server.submitTransaction(tx)

                // Log all useful public keys
                console.log({
                    ...intent,
                    'Solana controller public key': solanaControllerKeyPair.publicKey.toBase58(),
                    'Solana first validator public key': firstValidatorSolanaKeyPair.publicKey.toBase58(),
                    'Solana mint public key': mintResult.mintAddress,
                })

                // Add first validator to Mint (Solana)
                const addFirstValidatorToMintIntent = await bridgeService.addValidatorToMintIntent(
                    validator,
                    Asset.native()
                )

                const addFirstValidatorToMintTxBuffer = Buffer.from(
                    addFirstValidatorToMintIntent.solanaTransactionBase64,
                    'base64'
                )
                const addFirstValidatorToMintTx = web3.Transaction.from(addFirstValidatorToMintTxBuffer)
                expect(addFirstValidatorToMintTx.verifySignatures()).toBe(false)
                addFirstValidatorToMintTx.partialSign(firstValidatorSolanaKeyPair)
                expect(addFirstValidatorToMintTx.verifySignatures()).toBe(true)
                const addFirstValidatorToMintTxSignature = await sendAndConfirmRawTransaction(
                    connection,
                    addFirstValidatorToMintTx.serialize()
                )
                console.log(
                    'added first validator to mint, solana tx id:',
                    addFirstValidatorToMintTxSignature,
                    addFirstValidatorToMintIntent
                )

                //Add second validator to Vault (Stellar)
                const secondValidator = new Validator(
                    secondValidatorStellarKeyPair.publicKey(),
                    secondValidatorSolanaKeyPair.publicKey.toBase58()
                )
                const secondIntent = await bridgeService.getAddValidatorToVaultIntent(secondValidator)
                const secondTx = TransactionBuilder.fromXDR(
                    secondIntent.transactionXdr,
                    process.env.HORIZON_NETWORK_PASSPHRASE
                )

                secondTx.sign(firstValidatorStellarKeyPair, secondValidatorStellarKeyPair)

                const feeBump = TransactionBuilder.buildFeeBumpTransaction(
                    secondValidatorStellarKeyPair,
                    BASE_FEE,
                    secondTx as Transaction,
                    process.env.HORIZON_NETWORK_PASSPHRASE
                )
                feeBump.sign(secondValidatorStellarKeyPair)

                await server.submitTransaction(feeBump)

                // Log all useful public keys
                console.log({
                    ...secondIntent,
                    'Solana second validator public key': secondValidatorSolanaKeyPair.publicKey.toBase58(),
                })

                // Add second validator to Mint (Solana)
                const addSecondValidatorToMintIntent = await bridgeService.addValidatorToMintIntent(
                    secondValidator,
                    Asset.native()
                )

                const addSecondValidatorToMintTxBuffer = Buffer.from(
                    addSecondValidatorToMintIntent.solanaTransactionBase64,
                    'base64'
                )
                const addSecondValidatorToMintTx = web3.Transaction.from(addSecondValidatorToMintTxBuffer)
                expect(addSecondValidatorToMintTx.verifySignatures()).toBe(false)
                addSecondValidatorToMintTx.partialSign(firstValidatorSolanaKeyPair, secondValidatorSolanaKeyPair)
                expect(addSecondValidatorToMintTx.verifySignatures()).toBe(true)
                const addSecondValidatorToMintTxSignature = await sendAndConfirmRawTransaction(
                    connection,
                    addSecondValidatorToMintTx.serialize()
                )
                console.log('added second validator to mint', addSecondValidatorToMintTxSignature)

                // ==
                // Bridge XLM to wXLM. Pay XLM in Stellar and mint wXLM on Solana
                // ==
                const mint = await bridgeService.getSolanaMint(Asset.native())
                const associatedTokenAccount = await getOrCreateAssociatedTokenAccount(
                    connection,
                    userSolanaKeyPair,
                    new web3.PublicKey(mint.mintPublicKey),
                    userSolanaKeyPair.publicKey
                )

                console.log('associated token account', associatedTokenAccount.address.toBase58())

                // Begin locking an asset into stellar by sending a claimable balance to the ETxA
                const beginLockIntoStellarIntent = await bridgeService.beginLockAssetIntoStellar(
                    Asset.native(),
                    '100',
                    user,
                    associatedTokenAccount.address.toBase58()
                )
                console.log(beginLockIntoStellarIntent)

                const lockTx = TransactionBuilder.fromXDR(
                    beginLockIntoStellarIntent.transactionXdr,
                    process.env.HORIZON_NETWORK_PASSPHRASE
                )

                lockTx.sign(userStellarKeyPair)

                let lockIntoStellarFeeBump = TransactionBuilder.buildFeeBumpTransaction(
                    userStellarKeyPair,
                    BASE_FEE,
                    lockTx as Transaction,
                    process.env.HORIZON_NETWORK_PASSPHRASE
                )
                lockIntoStellarFeeBump.sign(userStellarKeyPair)

                const lockIntoStellarResponse = (await server.submitTransaction(
                    lockIntoStellarFeeBump
                )) as TransactionResponse
                console.log('lock into stellar, tx id:', lockIntoStellarResponse.id)

                // Begin mint wrapped assets in Solana
                const beginMintWrappedSolanaAssetIntent = await bridgeService.beginMintWrappedSolanaAsset(
                    user,
                    beginLockIntoStellarIntent.etxaPublicKey
                )
                console.log('begin mint wrapped solana asset intent', beginMintWrappedSolanaAssetIntent)

                const beginMintWrappedSolanaAssetTx = TransactionBuilder.fromXDR(
                    beginMintWrappedSolanaAssetIntent.transactionXdr,
                    process.env.HORIZON_NETWORK_PASSPHRASE
                )
                beginMintWrappedSolanaAssetTx.sign(firstValidatorStellarKeyPair)
                const beginMintWrappedSolanaAssetTxResult = (await server.submitTransaction(
                    beginMintWrappedSolanaAssetTx
                )) as TransactionResponse
                console.log('Begin mint wrapped solana asset, tx id:', beginMintWrappedSolanaAssetTxResult.id)

                // Complete mint wrapped assets in Solana
                const mintWrappedSolanaAssetIntent = await bridgeService.completeMintWrappedSolanaAsset(
                    user,
                    beginLockIntoStellarIntent.etxaPublicKey,
                    beginMintWrappedSolanaAssetIntent.solanaTransactionBase64
                )
                const mintWrappedSolanaAssetTxBuffer = Buffer.from(
                    mintWrappedSolanaAssetIntent.solanaTransactionBase64,
                    'base64'
                )
                const mintWrappedSolanaAssetTx = web3.Transaction.from(mintWrappedSolanaAssetTxBuffer)
                expect(mintWrappedSolanaAssetTx.verifySignatures()).toBe(false)
                mintWrappedSolanaAssetTx.partialSign(
                    firstValidatorSolanaKeyPair,
                    secondValidatorSolanaKeyPair,
                    userSolanaKeyPair
                )
                expect(mintWrappedSolanaAssetTx.verifySignatures()).toBe(true)
                const mintWrappedSolanaAssetIntentTxSignature = await sendAndConfirmRawTransaction(
                    connection,
                    mintWrappedSolanaAssetTx.serialize()
                )
                console.log('minted wrapped asset, solana tx id:', mintWrappedSolanaAssetIntentTxSignature)

                // Finish bridge  op. Claim claimable balance and delete ETxA
                const completeLockAssetIntoStellarIntent = await bridgeService.completeLockAssetIntoStellar(
                    beginLockIntoStellarIntent.etxaPublicKey,
                    mintWrappedSolanaAssetIntentTxSignature
                )

                const completeLockAssetIntoStellarTx = TransactionBuilder.fromXDR(
                    completeLockAssetIntoStellarIntent.transactionXdr,
                    process.env.HORIZON_NETWORK_PASSPHRASE
                )

                completeLockAssetIntoStellarTx.sign(firstValidatorStellarKeyPair)

                const result = (await server.submitTransaction(completeLockAssetIntoStellarTx)) as TransactionResponse

                console.log('Successfully locked assets. Stellar tx id: ', result.id)
            } catch (e) {
                console.error(e)
                throw e
            }
        })
    })

    describe('Lock in XLM on Stellar and mint wXLM on Solana', () => {})
})
