import * as anchor from "@project-serum/anchor";
import {Program} from "@project-serum/anchor";
import {Charon} from "../target/types/charon";
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    AuthorityType,
    createMultisig,
    getAssociatedTokenAddress,
    setAuthority,
    TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import {LAMPORTS_PER_SOL, PublicKey} from "@solana/web3.js"

const {SystemProgram} = anchor.web3;

describe("charon", async () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.Charon as Program<Charon>;

    //the programOwner is the controller
    const programOwner = provider.wallet;
    const receiver = anchor.web3.Keypair.generate();

    const validator1 = anchor.web3.Keypair.generate();
    const validator2 = anchor.web3.Keypair.generate();
    const validator3 = anchor.web3.Keypair.generate();
    const validator4 = anchor.web3.Keypair.generate();
    const validator5 = anchor.web3.Keypair.generate();
    const validator6 = anchor.web3.Keypair.generate();

    let vault1: PublicKey = null;
    let vault2: PublicKey = null;
    let vaultMultiSig: PublicKey = null;

    const MAX_ASSET_CODE = 12;
    const WXLM = Buffer.from(anchor.utils.bytes.utf8.encode("WXLM3".padEnd(MAX_ASSET_CODE, " ")));

    const [mintProgramDerivedAddress] = await anchor.web3.PublicKey.findProgramAddress(
        [
            Buffer.from(anchor.utils.bytes.utf8.encode("charon")),
            WXLM
        ], program.programId
    );

    const associatedTokenAccount = await getAssociatedTokenAddress(
        mintProgramDerivedAddress,
        receiver.publicKey,
        true,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    it("funds accounts", async () => {
        await provider.connection.requestAirdrop(receiver.publicKey, 20 * LAMPORTS_PER_SOL)
        await provider.connection.requestAirdrop(validator1.publicKey, 1 * LAMPORTS_PER_SOL)
        await provider.connection.requestAirdrop(validator2.publicKey, 1 * LAMPORTS_PER_SOL)
        await provider.connection.requestAirdrop(validator3.publicKey, 1 * LAMPORTS_PER_SOL)
        await provider.connection.requestAirdrop(validator4.publicKey, 1 * LAMPORTS_PER_SOL)
        await provider.connection.requestAirdrop(validator5.publicKey, 1 * LAMPORTS_PER_SOL)
        const lastTx = await provider.connection.requestAirdrop(validator6.publicKey, 1 * LAMPORTS_PER_SOL)
        await provider.connection.confirmTransaction(lastTx)
        console.log(receiver.publicKey.toBase58(), validator1.publicKey.toBase58(), validator2.publicKey.toBase58(), validator3.publicKey.toBase58(), validator4.publicKey.toBase58(), validator5.publicKey.toBase58(), validator6.publicKey.toBase58());
    });

    it("creates multisig vaults", async () => {
        vault1 = await createMultisig(provider.connection, receiver, [validator1.publicKey, validator2.publicKey, validator3.publicKey], 2,);
        vault2 = await createMultisig(provider.connection, receiver, [validator4.publicKey, validator5.publicKey, validator6.publicKey], 2,);
        vaultMultiSig = await createMultisig(provider.connection, receiver, [vault1, vault2], 1);

        console.log(vault1.toBase58(), vault2.toBase58(), vaultMultiSig.toBase58());
    });

    it("sets up mint once", async () => {
        try {
            const setupMintOnceTx = await program.methods.setupMint(
                Array.from(WXLM),
                vault1
            ).accounts({
                payer: programOwner.publicKey,
                mint: mintProgramDerivedAddress,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY
            })
                .rpc();
            console.log('setup mint once tx', setupMintOnceTx);
        } catch (e) {
            console.error(e);
            throw e;
        }
    });

    it("sets up mint once", async () => {
        try {
            const setupMintOnceTx = await program.methods.setupMint(
                Array.from(WXLM),
                vault1
            ).accounts({
                payer: programOwner.publicKey,
                mint: mintProgramDerivedAddress,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY
            })
                .rpc();
            console.log('setup mint once tx', setupMintOnceTx);
            console.log('mint address: ', mintProgramDerivedAddress.toBase58());
            // const auth = await setAuthority(provider.connection, receiver, mintProgramDerivedAddress, programOwner.publicKey, AuthorityType.AccountOwner, vault1, [
            //     validator1, validator2
            // ])
            // console.log(auth);

        } catch (e) {
            console.error(e);
            throw e;
        }
    });

    it("pays the wrapped asset", async () => {
        try {
            // 10000000 = 1 wXLM
            const mintWrappedAssetTx = await program.methods.mintWrappedAsset(Array.from(WXLM), new anchor.BN(10_000_000))
                .accounts({
                    receiver: receiver.publicKey,
                    destination: associatedTokenAccount,
                    mint: mintProgramDerivedAddress,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                    rent: anchor.web3.SYSVAR_RENT_PUBKEY
                })
                .signers([receiver])
                .rpc();
            console.log('mint wrapped asset tx', mintWrappedAssetTx);
        } catch (e) {
            console.error(e);
            throw e;
        }
    });
});
