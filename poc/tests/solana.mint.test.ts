// noinspection DuplicatedCode
import {config} from "dotenv";
import {
    AuthorityType,
    createMint,
    createMultisig,
    getOrCreateAssociatedTokenAccount,
    mintTo,
    setAuthority
} from "@solana/spl-token";
import * as web3 from "@solana/web3.js"
import {LAMPORTS_PER_SOL, PublicKey} from "@solana/web3.js"

config();
jest.setTimeout(3000000);

const connection = new web3.Connection(process.env.SOLANA_CLUSTER_URL, 'confirmed');

const receiver = web3.Keypair.generate();

const validator1 = web3.Keypair.generate();
const validator2 = web3.Keypair.generate();
const validator3 = web3.Keypair.generate();
const validator4 = web3.Keypair.generate();
const validator5 = web3.Keypair.generate();
const validator6 = web3.Keypair.generate();

let vault1: PublicKey = null;
let vault2: PublicKey = null;
let vaultMultiSig: PublicKey = null;
let mint: PublicKey = null;


describe("Mint authority tests", () => {
    it("funds accounts", async () => {
        await connection.requestAirdrop(receiver.publicKey, 20 * LAMPORTS_PER_SOL)
        await connection.requestAirdrop(validator1.publicKey, 1 * LAMPORTS_PER_SOL)
        await connection.requestAirdrop(validator2.publicKey, 1 * LAMPORTS_PER_SOL)
        await connection.requestAirdrop(validator3.publicKey, 1 * LAMPORTS_PER_SOL)
        await connection.requestAirdrop(validator4.publicKey, 1 * LAMPORTS_PER_SOL)
        await connection.requestAirdrop(validator5.publicKey, 1 * LAMPORTS_PER_SOL)
        const lastTx = await connection.requestAirdrop(validator6.publicKey, 1 * LAMPORTS_PER_SOL)
        await connection.confirmTransaction(lastTx)
        console.log(receiver.publicKey.toBase58(), validator1.publicKey.toBase58(), validator2.publicKey.toBase58(), validator3.publicKey.toBase58(), validator4.publicKey.toBase58(), validator5.publicKey.toBase58(), validator6.publicKey.toBase58());
    });

    it("creates multisig vaults", async () => {
        vault1 = await createMultisig(connection, receiver, [validator1.publicKey, validator2.publicKey, validator3.publicKey], 2,);
        vault2 = await createMultisig(connection, receiver, [validator4.publicKey, validator5.publicKey, validator6.publicKey], 2,);
        vaultMultiSig = await createMultisig(connection, receiver, [vault1, vault2], 1);

        console.log(vault1.toBase58(), vault2.toBase58(), vaultMultiSig.toBase58());
    });

    it("sets up mint", async () => {
        try {
            const STELLAR_MAX_DECIMALS = 7;
            mint = await createMint(
                connection,
                receiver,
                vault1,
                null,
                STELLAR_MAX_DECIMALS
            );

            console.log('mint address', mint.toBase58());
        } catch (e) {
            console.error(e);
            throw e;
        }
    });

    it("pays the wrapped asset", async () => {
        try {

            const associatedTokenAccount = await getOrCreateAssociatedTokenAccount(
                connection,
                receiver,
                mint,
                receiver.publicKey
            );

            // 10_000_000 = 1 wXLM
            const mintWrappedAssetSignature = await mintTo(
                connection,
                receiver,
                mint,
                associatedTokenAccount.address,
                vault1,
                10_000_000,
                [
                    validator1, validator2
                ]
            )
            console.log('mint wrapped asset tx', mintWrappedAssetSignature);
        } catch (e) {
            console.error(e);
            throw e;
        }
    });


    it("setting up multi-vault mint with nested validators becomes unsignable", async () => {
        try {
            const mint = await createMint(
                connection,
                receiver,
                vaultMultiSig,
                null,
                7
            );

            console.log('mint address', mint.toBase58());

            const associatedTokenAccount = await getOrCreateAssociatedTokenAccount(
                connection,
                receiver,
                mint,
                receiver.publicKey
            );

            await expect(async () => {
                // 10_000_000 = 1 wXLM
                const mintWrappedAssetSignature = await mintTo(
                    connection,
                    receiver,
                    mint,
                    associatedTokenAccount.address,
                    vaultMultiSig,
                    10_000_000,
                    [
                        validator1, validator2, validator3, validator4, validator5, validator6
                    ]
                )

                console.log('mint wrapped asset tx', mintWrappedAssetSignature);

                return mintWrappedAssetSignature;
            }).rejects.toThrow();

        } catch (e) {
            console.error(e);
            throw e;
        }
    });

    it("change mint authority", async () => {
        try {
            const mint = await createMint(
                connection,
                receiver,
                vault1,
                null,
                7
            );

            console.log('mint address', mint.toBase58());

            const associatedTokenAccount = await getOrCreateAssociatedTokenAccount(
                connection,
                receiver,
                mint,
                receiver.publicKey
            );

            await setAuthority(connection, receiver, mint, vault1, AuthorityType.MintTokens, vault2, [
                validator1, validator2, validator3
            ]);

            // 10_000_000 = 1 wXLM
            const mintWrappedAssetSignature = await mintTo(
                connection,
                receiver,
                mint,
                associatedTokenAccount.address,
                vault2,
                10_000_000,
                [
                    validator4, validator5
                ]
            )

            console.log('mint wrapped asset tx', mintWrappedAssetSignature);

            return mintWrappedAssetSignature;


        } catch (e) {
            console.error(e);
            throw e;
        }
    });
})
