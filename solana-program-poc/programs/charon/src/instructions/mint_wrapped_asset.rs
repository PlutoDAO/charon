use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};

#[derive(Accounts)]
#[instruction(code: [u8; 12])]
pub struct MintWrappedAssetInstruction<'info> {
    #[account(
    init,
    payer = receiver,
    associated_token::mint = mint,
    associated_token::authority = receiver
    )]
    pub destination: Account<'info, TokenAccount>,
    #[account(mut, seeds = [b"charon".as_ref(), &code], bump)]
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub receiver: Signer<'info>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
