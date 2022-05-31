use anchor_lang::prelude::*;

use crate::instructions::mint_wrapped_asset::*;
use crate::instructions::setup_mint_once::*;

mod instructions;

declare_id!("ArWpEgPv1eM8m7tU1L8hVN1Zh4vXQLi7kC4wko9SSmB1");

#[program]
pub mod charon {
    use super::*;

    pub fn setup_mint(_ctx: Context<SetupMintOnceInstruction>, _code: [u8; 12]) -> Result<()> {
        msg!(&String::from_utf8(_code.to_vec()).unwrap());
        Ok(())
    }

    pub fn mint_wrapped_asset(ctx: Context<MintWrappedAssetInstruction>, code: [u8; 12], amount: u64) -> Result<()> {
        msg!(&String::from_utf8(code.to_vec()).unwrap());
        anchor_spl::token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token::MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.destination.to_account_info(),
                    authority: ctx.accounts.mint.to_account_info(),
                },
                &[&[&"charon".as_bytes(), &code, &[*ctx.bumps.get("mint").unwrap()]]],
            ),
            amount,
        )?;

        Ok(())
    }
}

// IncomingXct -> id is a stellar account
// OutgoingXct -> id is the tx signature, does it matter? probably not.
// amount -> u64, represents how much $$$ are we paying the target account
// create token program account for user
// bridge fee was already charged by stellar, we only need to get the user to pay for network fee
// delete xct account after the tx is done (funds paid to user)
// ideally we need multi-signatures. M-of-N but for Solana. Start with 1, then add another one.
