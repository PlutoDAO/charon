use anchor_lang::prelude::*;
use anchor_spl::{
    token::{Mint, Token},
};

#[derive(Accounts)]
#[instruction(code: [u8; 12], multi_sig: Pubkey)]
pub struct SetupMintOnceInstruction<'info> {
    #[account(
    init_if_needed,
    payer = payer,
    seeds = [b"charon".as_ref(), &code],
    bump,
    mint::decimals = 7,
    mint::authority = multi_sig
    )]
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
