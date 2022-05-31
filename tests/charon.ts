import * as anchor from "@project-serum/anchor";
import {Program} from "@project-serum/anchor";
import {Charon} from "../target/types/charon";
import {ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress, TOKEN_PROGRAM_ID} from "@solana/spl-token";
import {LAMPORTS_PER_SOL} from "@solana/web3.js"

const {SystemProgram} = anchor.web3;

describe("charon", async () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.Charon as Program<Charon>;
    const programOwner = provider.wallet;
    const receiver = anchor.web3.Keypair.generate();

    const MAX_ASSET_CODE = 12;
    const WXLM = Buffer.from(anchor.utils.bytes.utf8.encode("WXLM".padEnd(MAX_ASSET_CODE, " ")));

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

    it("funds the receiver", async () => {
        try {
            const transaction = new anchor.web3.Transaction().add(
                anchor.web3.SystemProgram.transfer({
                    fromPubkey: provider.wallet.publicKey,
                    toPubkey: receiver.publicKey,
                    lamports: LAMPORTS_PER_SOL,
                })
            );

            const blockHash = await provider.connection.getLatestBlockhash();
            transaction.recentBlockhash = blockHash.blockhash;
            transaction.feePayer = provider.wallet.publicKey;
            const signedTx = await provider.wallet.signTransaction(transaction);
            const signature = await provider.connection.sendRawTransaction(signedTx.serialize())
            await provider.connection.confirmTransaction({
                signature,
                blockhash: blockHash.blockhash,
                lastValidBlockHeight: blockHash.lastValidBlockHeight
            })

            const receiverBalance = await provider.connection.getBalance(receiver.publicKey);
            const programOwnerBalance = await provider.connection.getBalance(programOwner.publicKey);
            console.log('receiver balance', receiverBalance, 'program owner balance', programOwnerBalance);
        } catch (e) {
            console.error(e);
        }
    });

    it("sets up mint once", async () => {

        try {
            const setupMintOnceTx = await program.methods.setupMint(
                Array.from(WXLM)
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
        }
    });
});
