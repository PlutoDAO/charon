import { Asset, BASE_FEE, Claimant, Horizon, Keypair, Operation, Server, TransactionBuilder } from 'stellar-sdk'
import { Controller, Mint, User, Validator, Vault } from '../domain'
import {
    AuthorityType,
    createInitializeMultisigInstruction,
    createMint,
    createMintToInstruction,
    createSetAuthorityInstruction,
    getMinimumBalanceForRentExemptMultisig,
    getMint,
    getMultisig,
    MULTISIG_SIZE,
    TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import * as web3 from '@solana/web3.js'
import { SystemProgram, Transaction } from '@solana/web3.js'
import { NoVaultsError } from '../domain/errors'
import crypto from 'crypto'
import { Buffer } from 'buffer'
import BalanceLineAsset = Horizon.BalanceLineAsset

export interface ICreateSolanaMintResult {
    stellarTxId: string
    mintAddress: string
}

export interface ICreateVaultIntent {
    transactionXdr: string
    vaultPublicKey: string
    validatorEscrow: string
    validatorPublicKey: string
    controllerPublicKey: string
    controllerConfigPublicKey: string
}

export interface IAddValidatorToMintIntent {
    mintPublicKey: string
    validatorPublicKey: string
    multiSigPublicKey: string
    controllerPublicKey: string
    solanaTransactionBase64: string
}

export interface IStartLockIntoStellarIntent {
    transactionXdr: string
    vaultPublicKey: string
    etxaPublicKey: string
    controllerPublicKey: string
}

export interface IBeginMintWrappedSolanaAssetIntent {
    targetWalletPublicKey: string
    mintPublicKey: string
    solanaTransactionBase64: string
    transactionXdr: string
    controllerPublicKey: string
    mintAuthorityPublicKey: string
    solanaTransactionSignatureSha256: string
}

export interface ICompleteMintWrappedSolanaAssetIntent {
    targetWalletPublicKey: string
    solanaTransactionBase64: string
    controllerPublicKey: string
    solanaTransactionSignatureSha256: string
}

export interface ICompleteLockIntoStellarIntent {
    transactionXdr: string
    vaultPublicKey: string
    etxaPublicKey: string
    controllerPublicKey: string
    claimableBalanceId: string
}

export class BridgeService {
    constructor(
        public horizonServer: Server,
        public solanaConnection: web3.Connection,
        public stellarControllerKeyPair: Keypair,
        public stellarControllerConfigKeyPair: Keypair,
        public solanaControllerKeyPair: web3.Keypair
    ) {}

    async getSolanaMint(asset: Asset): Promise<Mint> {
        const account = await this.horizonServer.loadAccount(this.stellarControllerConfigKeyPair.publicKey())
        const mintAddress = Buffer.from(
            account.data_attr[Controller.getSolanaMintAttributeName(asset)],
            'base64'
        ).toString('utf8')

        const mint = await getMint(this.solanaConnection, new web3.PublicKey(mintAddress))
        const mintAuthority = await this.solanaConnection.getAccountInfo(mint.mintAuthority)
        let validators: Validator[] = []
        if (!mintAuthority.owner.equals(SystemProgram.programId)) {
            const multiSig = await getMultisig(this.solanaConnection, mint.mintAuthority)
            const signers = [
                multiSig.signer1,
                multiSig.signer2,
                multiSig.signer3,
                multiSig.signer4,
                multiSig.signer5,
                multiSig.signer6,
                multiSig.signer7,
                multiSig.signer8,
                multiSig.signer9,
                multiSig.signer10,
                multiSig.signer11,
            ]

            validators = signers
                .reduce((acc, signer, i) => {
                    if (
                        signer.equals(SystemProgram.programId) ||
                        signer.equals(this.solanaControllerKeyPair.publicKey)
                    ) {
                        delete acc[i]
                    }

                    return acc
                }, signers)
                .map((signer) => new Validator(null, signer.toBase58()))
        }
        return new Mint(mintAddress, mint.mintAuthority.toBase58(), validators)
    }

    async createSolanaMint(asset: Asset): Promise<ICreateSolanaMintResult> {
        const server = this.horizonServer

        const STELLAR_MAX_DECIMALS = 7
        const mint = await createMint(
            this.solanaConnection,
            this.solanaControllerKeyPair,
            this.solanaControllerKeyPair.publicKey,
            null,
            STELLAR_MAX_DECIMALS
        )

        const mintAddress = mint.toBase58()

        const tx = new TransactionBuilder(await server.loadAccount(this.stellarControllerConfigKeyPair.publicKey()), {
            networkPassphrase: process.env.HORIZON_NETWORK_PASSPHRASE,
            fee: (await server.fetchBaseFee()).toString(),
        })
            .addOperation(
                Operation.manageData({
                    name: Controller.getSolanaMintAttributeName(asset),
                    value: mintAddress,
                })
            )
            .setTimeout(30)
            .build()

        tx.sign(this.stellarControllerConfigKeyPair)

        const result = (await server.submitTransaction(tx)) as Horizon.TransactionResponse
        return {
            stellarTxId: result.id,
            mintAddress,
        }
    }

    async getAddValidatorToVaultIntent(validator: Validator): Promise<ICreateVaultIntent> {
        const controller = new Controller(await this.getExistingVaults(), [])
        try {
            const vault = controller.addValidator(validator)

            const validatorEscrow = Keypair.random()

            //NOTE: Hardcoded for 2 validators on one vault
            const tx = new TransactionBuilder(
                await this.horizonServer.loadAccount(this.stellarControllerConfigKeyPair.publicKey()),
                {
                    networkPassphrase: process.env.HORIZON_NETWORK_PASSPHRASE,
                    fee: (await this.horizonServer.fetchBaseFee()).toString(),
                }
            )
                .addOperation(
                    Operation.createAccount({
                        source: validator.stellarPublicKey,
                        destination: validatorEscrow.publicKey(),
                        startingBalance: process.env.VALIDATOR_STAKING_AMOUNT,
                    })
                )
                .addOperation(
                    Operation.setOptions({
                        source: validatorEscrow.publicKey(),
                        signer: {
                            ed25519PublicKey: this.stellarControllerConfigKeyPair.publicKey(),
                            weight: 2,
                        },
                        masterWeight: 0,
                        lowThreshold: 2,
                        medThreshold: 2,
                        highThreshold: 2,
                    })
                )
                .addOperation(
                    Operation.setOptions({
                        source: validatorEscrow.publicKey(),
                        signer: {
                            ed25519PublicKey: validator.stellarPublicKey,
                            weight: 1,
                        },
                    })
                )
                .addOperation(
                    Operation.setOptions({
                        source: vault.publicKey,
                        signer: {
                            ed25519PublicKey: this.stellarControllerKeyPair.publicKey(),
                            weight: 2,
                        },
                    })
                )
                .addOperation(
                    Operation.payment({
                        asset: Asset.native(),
                        source: validator.stellarPublicKey,
                        destination: vault.publicKey,
                        amount: '0.5',
                    })
                )
                .addOperation(
                    Operation.setOptions({
                        source: vault.publicKey,
                        signer: {
                            ed25519PublicKey: validator.stellarPublicKey,
                            weight: 1,
                        },
                        masterWeight: 0,
                        lowThreshold: 3,
                        medThreshold: 3,
                        highThreshold: 3,
                    })
                )
                .setTimeout(30)
                .build()

            tx.sign(validatorEscrow, this.stellarControllerConfigKeyPair, this.stellarControllerKeyPair)

            return {
                controllerPublicKey: this.stellarControllerKeyPair.publicKey(),
                controllerConfigPublicKey: this.stellarControllerConfigKeyPair.publicKey(),
                validatorEscrow: validatorEscrow.publicKey(),
                validatorPublicKey: validator.stellarPublicKey,
                vaultPublicKey: vault.publicKey,
                transactionXdr: tx.toXDR(),
            }
        } catch (e) {
            if (e instanceof NoVaultsError) {
                return this.getCreateStellarVaultWithInitialValidatorIntent(validator)
            }
        }
    }

    async addValidatorToMintIntent(validator: Validator, asset: Asset): Promise<IAddValidatorToMintIntent> {
        const mint = await this.getSolanaMint(asset)
        const controller = new Controller(await this.getExistingVaults(), [mint])
        controller.addValidatorToMint(validator, mint)

        const mintPublicKey = new web3.PublicKey(mint.mintPublicKey)
        const validatorPublicKey = new web3.PublicKey(validator.solanaPublicKey)
        const multiSigKeyPair = web3.Keypair.generate()

        const validatorsPublicKeys = [...mint.validators]
            .filter((v) => v)
            .map((validator) => new web3.PublicKey(validator.solanaPublicKey))

        const tx = new web3.Transaction({
            feePayer: validatorPublicKey,
            recentBlockhash: (await this.solanaConnection.getLatestBlockhash()).blockhash,
        }).add(
            SystemProgram.createAccount({
                fromPubkey: validatorPublicKey,
                newAccountPubkey: multiSigKeyPair.publicKey,
                space: MULTISIG_SIZE,
                lamports: await getMinimumBalanceForRentExemptMultisig(this.solanaConnection),
                programId: TOKEN_PROGRAM_ID,
            }),
            createInitializeMultisigInstruction(
                multiSigKeyPair.publicKey,
                [
                    this.solanaControllerKeyPair.publicKey,
                    ...[...mint.validators]
                        .filter((v) => v)
                        .map((validator) => new web3.PublicKey(validator.solanaPublicKey)),
                    validatorPublicKey,
                ],
                validatorsPublicKeys.length + 1 // M. This is hardcoded to be N-1
            ),
            createSetAuthorityInstruction(
                mintPublicKey,
                new web3.PublicKey(mint.authority),
                AuthorityType.MintTokens,
                multiSigKeyPair.publicKey,
                validatorsPublicKeys.length
                    ? [
                          this.solanaControllerKeyPair,
                          ...validatorsPublicKeys.map((publicKey) => ({
                              publicKey: publicKey,
                              secretKey: null,
                          })),
                      ]
                    : []
            )
        )

        tx.partialSign(this.solanaControllerKeyPair, multiSigKeyPair)

        return {
            mintPublicKey: mintPublicKey.toBase58(),
            controllerPublicKey: this.solanaControllerKeyPair.publicKey.toBase58(),
            multiSigPublicKey: multiSigKeyPair.publicKey.toBase58(),
            validatorPublicKey: validatorPublicKey.toBase58(),
            solanaTransactionBase64: Buffer.from(tx.serialize({ requireAllSignatures: false })).toString('base64'),
        }
    }

    async beginLockAssetIntoStellar(
        asset: Asset,
        amount: string,
        user: User,
        associatedTokenAccount: string
    ): Promise<IStartLockIntoStellarIntent> {
        const mint = await this.getSolanaMint(asset)
        const controller = new Controller(await this.getExistingVaults(), [mint])
        const vault = controller.lockStellarAsset(asset, amount)

        const etxa = Keypair.random()

        const tx = new TransactionBuilder(await this.horizonServer.loadAccount(user.stellarPublicKey), {
            networkPassphrase: process.env.HORIZON_NETWORK_PASSPHRASE,
            fee: (await this.horizonServer.fetchBaseFee()).toString(),
        })
            .addOperation(
                Operation.createAccount({
                    source: user.stellarPublicKey,
                    destination: etxa.publicKey(),
                    startingBalance: '10',
                })
            )
            // todo: these 2 validators are hardcoded to be 2, instead, looping through the vault validators is required.
            .addOperation(
                Operation.setOptions({
                    source: etxa.publicKey(),
                    signer: {
                        ed25519PublicKey: vault.validators.at(0).stellarPublicKey,
                        weight: 2,
                    },
                })
            )
            .addOperation(
                Operation.setOptions({
                    source: etxa.publicKey(),
                    signer: {
                        ed25519PublicKey: vault.validators.at(1).stellarPublicKey,
                        weight: 2,
                    },
                })
            )
            .addOperation(
                Operation.setOptions({
                    masterWeight: 0,
                    source: etxa.publicKey(),
                    signer: {
                        ed25519PublicKey: this.stellarControllerKeyPair.publicKey(),
                        weight: 4,
                    },
                    lowThreshold: 6,
                    medThreshold: 6,
                    highThreshold: 6,
                })
            )
            .addOperation(
                Operation.setOptions({
                    source: etxa.publicKey(),
                    signer: {
                        ed25519PublicKey: user.stellarPublicKey,
                        weight: 1,
                    },
                })
            )
            .addOperation(
                Operation.createClaimableBalance({
                    source: user.stellarPublicKey,
                    claimants: [
                        new Claimant(etxa.publicKey(), Claimant.predicateBeforeRelativeTime('300')),
                        new Claimant(
                            user.stellarPublicKey,
                            Claimant.predicateNot(Claimant.predicateBeforeRelativeTime('301'))
                        ),
                    ],
                    asset,
                    amount,
                })
            )
            .addOperation(
                Operation.manageData({
                    source: etxa.publicKey(),
                    name: 'target_chain',
                    value: 'solana',
                })
            )
            .addOperation(
                Operation.manageData({
                    source: etxa.publicKey(),
                    name: 'target_wallet',
                    value: associatedTokenAccount,
                })
            )
            .addOperation(
                Operation.manageData({
                    source: etxa.publicKey(),
                    name: 'state',
                    value: 'source_started',
                })
            )
            .setTimeout(30)
            .build()

        tx.sign(etxa)

        return {
            transactionXdr: tx.toXDR(),
            controllerPublicKey: this.stellarControllerKeyPair.publicKey(),
            vaultPublicKey: vault.publicKey,
            etxaPublicKey: etxa.publicKey(),
        }
    }

    async beginMintWrappedSolanaAsset(user: User, etxaPublicKey: string): Promise<IBeginMintWrappedSolanaAssetIntent> {
        const etxa = await this.horizonServer.loadAccount(etxaPublicKey)
        let asset, firstBalance
        if (etxa.balances.length === 1) {
            firstBalance = etxa.balances[0]
            asset = Asset.native()
        } else {
            firstBalance = etxa.balances.find((b) => b.asset_type !== 'native') as BalanceLineAsset
            asset = new Asset(firstBalance.asset_code, firstBalance.asset_issuer)
        }
        const amount = firstBalance.balance
        const mint = await this.getSolanaMint(asset)

        const targetWallet = new web3.PublicKey(Buffer.from(etxa.data_attr['target_wallet'], 'base64').toString('utf8'))

        const validatorsPublicKeys = [...mint.validators]
            .filter((v) => v)
            .map((validator) => new web3.PublicKey(validator.solanaPublicKey))

        // 10_000_000 = 1 wXLM
        const tx = new Transaction({
            feePayer: new web3.PublicKey(user.solanaPublicKey),
            recentBlockhash: (await this.solanaConnection.getLatestBlockhash()).blockhash,
        }).add(
            createMintToInstruction(
                new web3.PublicKey(mint.mintPublicKey),
                targetWallet,
                new web3.PublicKey(mint.authority),
                amount * 10_000_000,
                [
                    this.solanaControllerKeyPair,
                    ...validatorsPublicKeys.map((publicKey) => ({
                        publicKey: publicKey,
                        secretKey: null,
                    })),
                ]
            )
        )

        tx.partialSign(this.solanaControllerKeyPair)
        const signature = tx.signatures.filter((s) => s.signature).pop()
        const sha256Signature = crypto.createHash('sha256').update(signature.signature).digest('hex')
        // clear the signature so it can't be signed by validators yet
        signature.signature = null

        const stellarTx = new TransactionBuilder(await this.horizonServer.loadAccount(etxaPublicKey), {
            fee: BASE_FEE,
            networkPassphrase: process.env.HORIZON_NETWORK_PASSPHRASE,
        })
            .addOperation(
                Operation.manageData({
                    source: etxaPublicKey,
                    name: 'target_transaction_id',
                    value: sha256Signature,
                })
            )
            .addOperation(
                Operation.manageData({
                    source: etxaPublicKey,
                    name: 'state',
                    value: 'target_started',
                })
            )
            .setTimeout(30)
            .build()

        stellarTx.sign(this.stellarControllerKeyPair)

        return {
            transactionXdr: stellarTx.toXDR(),
            targetWalletPublicKey: targetWallet.toBase58(),
            mintPublicKey: mint.mintPublicKey,
            solanaTransactionBase64: Buffer.from(tx.serialize({ requireAllSignatures: false })).toString('base64'),
            controllerPublicKey: this.solanaControllerKeyPair.publicKey.toBase58(),
            mintAuthorityPublicKey: mint.authority,
            solanaTransactionSignatureSha256: sha256Signature,
        }
    }

    async completeMintWrappedSolanaAsset(
        user: User,
        etxaPublicKey: string,
        solanaTransactionBase64: string
    ): Promise<ICompleteMintWrappedSolanaAssetIntent> {
        const etxa = await this.horizonServer.loadAccount(etxaPublicKey)
        const etxaTargetTransactionId = Buffer.from(etxa.data_attr['target_transaction_id'], 'base64').toString('utf8')
        const targetWallet = new web3.PublicKey(Buffer.from(etxa.data_attr['target_wallet'], 'base64').toString('utf8'))

        const txBuffer = Buffer.from(solanaTransactionBase64, 'base64')
        const tx = web3.Transaction.from(txBuffer)
        tx.partialSign(this.solanaControllerKeyPair)
        const signature = tx.signatures.filter((s) => s.signature).pop()
        const sha256Signature = crypto.createHash('sha256').update(signature.signature).digest('hex')

        if (etxaTargetTransactionId !== sha256Signature) {
            throw new Error('Signature mismatch. ETxA and Solana transaction signature do not match.')
        }

        return {
            targetWalletPublicKey: targetWallet.toBase58(),
            solanaTransactionBase64: Buffer.from(tx.serialize({ requireAllSignatures: false })).toString('base64'),
            controllerPublicKey: this.solanaControllerKeyPair.publicKey.toBase58(),
            solanaTransactionSignatureSha256: etxaTargetTransactionId,
        }
    }

    public async completeLockAssetIntoStellar(
        etxaPublicKey: string,
        solanaTxId: string
    ): Promise<ICompleteLockIntoStellarIntent> {
        let asset, firstBalance
        const solanaTransaction = await this.solanaConnection.getTransaction(solanaTxId)
        const etxa = await this.horizonServer.loadAccount(etxaPublicKey)

        const etxaTargetTransactionId = Buffer.from(etxa.data_attr['target_transaction_id'], 'base64').toString('utf8')
        const mappedTransactions = solanaTransaction.transaction.signatures.map((s) => [
            s,
            crypto.createHash('sha256').update(s).digest('hex'),
        ])
        const isValidTransaction = solanaTransaction.transaction.signatures.some(
            (s) => crypto.createHash('sha256').update(s).digest('hex') === etxaTargetTransactionId
        )

        if (!isValidTransaction) {
            throw new Error('Invalid transaction. Signatures do not match.')
        }

        if (etxa.balances.length === 1) {
            firstBalance = etxa.balances[0]
            asset = Asset.native()
        } else {
            firstBalance = etxa.balances.find((b) => b.asset_type !== 'native') as BalanceLineAsset
            asset = new Asset(firstBalance.asset_code, firstBalance.asset_issuer)
        }
        const amount = firstBalance.balance
        const mint = await this.getSolanaMint(asset)
        const controller = new Controller(await this.getExistingVaults(), [mint])
        const vault = controller.mintWrappedAsset()

        // todo: this should also filter by sponsor
        const claimableBalance = await this.horizonServer.claimableBalances().claimant(etxa.accountId()).call()
        const claimableBalanceId = claimableBalance.records.at(0).id
        const tx = new TransactionBuilder(await this.horizonServer.loadAccount(etxaPublicKey), {
            fee: BASE_FEE,
            networkPassphrase: process.env.HORIZON_NETWORK_PASSPHRASE,
        })
            .addOperation(
                Operation.claimClaimableBalance({
                    source: etxa.accountId(),
                    balanceId: claimableBalanceId,
                })
            )
            .addOperation(
                Operation.payment({
                    source: etxa.accountId(),
                    asset: Asset.native(),
                    destination: vault.publicKey,
                    amount,
                })
            )
            // todo: Close ETxA account
            .setTimeout(30)
            .build()

        tx.sign(this.stellarControllerKeyPair)

        return {
            transactionXdr: tx.toXDR(),
            controllerPublicKey: this.stellarControllerKeyPair.publicKey(),
            vaultPublicKey: vault.publicKey,
            etxaPublicKey: etxa.accountId(),
            claimableBalanceId,
        }
    }

    private async getCreateStellarVaultWithInitialValidatorIntent(validator: Validator): Promise<ICreateVaultIntent> {
        const vault = Keypair.random()
        const validatorEscrow = Keypair.random()

        const tx = new TransactionBuilder(
            await this.horizonServer.loadAccount(this.stellarControllerConfigKeyPair.publicKey()),
            {
                networkPassphrase: process.env.HORIZON_NETWORK_PASSPHRASE,
                fee: (await this.horizonServer.fetchBaseFee()).toString(),
            }
        )
            .addOperation(
                Operation.createAccount({
                    source: validator.stellarPublicKey, //validator must sign
                    destination: validatorEscrow.publicKey(),
                    startingBalance: process.env.VALIDATOR_STAKING_AMOUNT,
                })
            )
            .addOperation(
                Operation.setOptions({
                    source: validatorEscrow.publicKey(), //validator escrow must sign
                    signer: {
                        ed25519PublicKey: this.stellarControllerConfigKeyPair.publicKey(), //stellar config may not need to sign
                        weight: 2,
                    },
                    masterWeight: 0,
                    lowThreshold: 2,
                    medThreshold: 2,
                    highThreshold: 2,
                })
            )
            .addOperation(
                Operation.setOptions({
                    source: validatorEscrow.publicKey(),
                    signer: {
                        ed25519PublicKey: validator.stellarPublicKey,
                        weight: 1,
                    },
                })
            )
            .addOperation(
                Operation.createAccount({
                    source: validator.stellarPublicKey,
                    destination: vault.publicKey(),
                    startingBalance: '2',
                })
            )
            .addOperation(
                Operation.setOptions({
                    source: vault.publicKey(),
                    signer: {
                        ed25519PublicKey: this.stellarControllerKeyPair.publicKey(),
                        weight: 1,
                    },
                })
            )
            .addOperation(
                Operation.setOptions({
                    source: vault.publicKey(),
                    signer: {
                        ed25519PublicKey: validator.stellarPublicKey,
                        weight: 1,
                    },
                    masterWeight: 0,
                    lowThreshold: 2,
                    medThreshold: 2,
                    highThreshold: 2,
                })
            )
            .setTimeout(30)
            .build()

        tx.sign(vault, validatorEscrow, this.stellarControllerConfigKeyPair)

        return {
            controllerPublicKey: this.stellarControllerKeyPair.publicKey(),
            controllerConfigPublicKey: this.stellarControllerConfigKeyPair.publicKey(),
            validatorEscrow: validatorEscrow.publicKey(),
            validatorPublicKey: validator.stellarPublicKey,
            vaultPublicKey: vault.publicKey(),
            transactionXdr: tx.toXDR(),
        }
    }

    private async getExistingVaults(): Promise<Vault[]> {
        const controllerSignedAccounts = await this.horizonServer
            .accounts()
            .forSigner(this.stellarControllerKeyPair.publicKey())
            .call()

        return controllerSignedAccounts.records
            .filter((account) => account.id !== this.stellarControllerKeyPair.publicKey())
            .map(
                (vaultAccount) =>
                    new Vault(
                        vaultAccount.id,
                        vaultAccount.signers
                            .filter(
                                (signer) =>
                                    signer.weight === 1 && signer.key !== this.stellarControllerKeyPair.publicKey()
                            )
                            .map((signer) => new Validator(signer.key, null))
                    )
            )
    }
}
