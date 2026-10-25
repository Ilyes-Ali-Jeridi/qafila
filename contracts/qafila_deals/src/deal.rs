//! Deal lifecycle (PLAN 3.3.4 + FLOWS 8). Order inside every function:
//! pause and state first, authorize, validate, update storage, token calls, event.
use soroban_sdk::{token::TokenClient, Address, BytesN, Env, Vec};

use crate::{
    admin::{require_admin, require_admin_or_agent, require_not_paused},
    attest,
    errors::Error,
    events::*,
    math, share, storage,
    types::*,
};

pub const MAX_HOLDERS_PAGE: u32 = 50;

fn now(env: &Env) -> u64 {
    env.ledger().timestamp()
}

fn settlement(env: &Env) -> Result<TokenClient<'_>, Error> {
    Ok(TokenClient::new(env, &storage::settlement(env)?))
}

fn pull(env: &Env, from: &Address, amount: i128) -> Result<(), Error> {
    if amount > 0 {
        let me = env.current_contract_address();
        settlement(env)?.transfer(from, &me, &amount);
    }
    Ok(())
}

fn push(env: &Env, to: &Address, amount: i128) -> Result<(), Error> {
    if amount > 0 {
        settlement(env)?.transfer(&env.current_contract_address(), to, &amount);
    }
    Ok(())
}

/// "Refund the security" (FLOWS 8): move the deal's held security into the
/// importer's pull-based refund balance.
fn refund_security(env: &Env, deal: &mut Deal) -> Result<(), Error> {
    if deal.security <= 0 {
        return Ok(());
    }
    let amount = deal.security;
    credit_refund(env, &deal.terms.importer, amount, deal.id)?;
    deal.security = 0;
    Ok(())
}

fn credit_refund(env: &Env, importer: &Address, amount: i128, deal_id: u64) -> Result<(), Error> {
    if amount <= 0 {
        return Ok(());
    }
    let cur = storage::refund_of(env, importer);
    storage::set_refund(env, importer, math::add(cur, amount)?);
    storage::add_inst_i128(env, &DataKey::RefundsOwed, amount)?;
    RefundOwed {
        importer: importer.clone(),
        deal_id,
        amount,
    }
    .publish(env);
    Ok(())
}

fn release_exposure(env: &Env, deal: &Deal) -> Result<(), Error> {
    let mut stats = storage::importer_stats(env, &deal.terms.importer);
    stats.open_exposure = math::sub(stats.open_exposure, deal.terms.cost)?;
    if stats.open_exposure < 0 {
        stats.open_exposure = 0;
    }
    storage::set_importer_stats(env, &deal.terms.importer, &stats);
    Ok(())
}

// ------------------------------------------------------------------ promise

pub fn promise_purchase(
    env: &Env,
    importer: Address,
    listing_fingerprint: BytesN<32>,
    promise_hash: BytesN<32>,
    security: i128,
) -> Result<(), Error> {
    require_not_paused(env)?;
    importer.require_auth();
    if security <= 0 {
        return Err(Error::InvalidAmount);
    }
    if storage::importer_stats(env, &importer).defaulted > 0 {
        return Err(Error::ImporterInDefault);
    }
    if storage::has_listing_fp(env, &listing_fingerprint) {
        return Err(Error::PromiseListed);
    }
    if let Some(existing) = storage::promise(env, &listing_fingerprint) {
        return Err(if existing.listed {
            Error::PromiseListed
        } else {
            Error::PromiseExists
        });
    }
    storage::set_promise(
        env,
        &listing_fingerprint,
        &PromiseRecord {
            importer: importer.clone(),
            promise_hash: promise_hash.clone(),
            security,
            at: now(env),
            listed: false,
        },
    );
    storage::add_inst_i128(env, &DataKey::PromiseHeld, security)?;
    pull(env, &importer, security)?;
    Promised {
        importer,
        listing_fingerprint,
        promise_hash,
        security,
    }
    .publish(env);
    Ok(())
}

/// Works while paused (FLOWS 8).
pub fn withdraw_promise(
    env: &Env,
    importer: Address,
    listing_fingerprint: BytesN<32>,
) -> Result<i128, Error> {
    importer.require_auth();
    let p = storage::promise(env, &listing_fingerprint).ok_or(Error::NoPromise)?;
    if p.importer != importer {
        return Err(Error::NotAuthorized);
    }
    if p.listed {
        return Err(Error::PromiseListed);
    }
    storage::remove_promise(env, &listing_fingerprint);
    storage::add_inst_i128(env, &DataKey::PromiseHeld, -p.security)?;
    push(env, &importer, p.security)?;
    PromiseWithdrawn {
        importer,
        listing_fingerprint,
        security: p.security,
    }
    .publish(env);
    Ok(p.security)
}

// ------------------------------------------------------------------ listing

fn validate_terms(env: &Env, cfg: &Config, terms: &DealTerms) -> Result<(), Error> {
    if terms.cost <= 0
        || terms.markup < 0
        || terms.platform_fee < 0
        || terms.late_fee < 0
        || terms.funding_deadline <= now(env)
        || terms.accept_window_secs == 0
        || terms.payout_token != storage::settlement(env)?
    {
        return Err(Error::InvalidTerms);
    }
    if terms.markup > math::bps_floor(terms.cost, cfg.max_markup_bps)? {
        return Err(Error::MarkupTooHigh);
    }
    if terms.platform_fee > terms.markup {
        return Err(Error::FeeExceedsMarkup);
    }
    if terms.deposit_bps > cfg.max_deposit_bps {
        return Err(Error::DepositTooHigh);
    }
    if terms.tenor_secs < cfg.min_tenor_secs {
        return Err(Error::TenorTooShort);
    }
    if !terms.halal_ok {
        return Err(Error::NotHalal);
    }
    Ok(())
}

pub fn list_deal(env: &Env, terms: DealTerms, sig: BytesN<64>) -> Result<u64, Error> {
    require_not_paused(env)?;
    require_admin(env)?;
    let cfg = storage::config(env)?;
    validate_terms(env, &cfg, &terms)?;

    // Security deposit (FLOWS 8).
    let stats = storage::importer_stats(env, &terms.importer);
    if terms.security >= terms.cost {
        return Err(Error::SecurityTooHigh);
    }
    if terms.security < math::required_security(&cfg, stats.on_time, terms.cost)? {
        return Err(Error::SecurityTooLow);
    }

    // Uniqueness.
    if storage::has_listing_fp(env, &terms.listing_fingerprint) {
        return Err(Error::ListingFingerprintUsed);
    }
    if storage::has_share_token(env, &terms.share_token) {
        return Err(Error::ShareTokenUsed);
    }

    // The importer's binding promise.
    let mut promise = storage::promise(env, &terms.listing_fingerprint).ok_or(Error::NoPromise)?;
    if promise.listed {
        return Err(Error::PromiseListed);
    }
    if promise.importer != terms.importer
        || promise.promise_hash != terms.promise_hash
        || promise.security != terms.security
    {
        return Err(Error::PromiseMismatch);
    }

    // Importer standing.
    if stats.defaulted > 0 {
        return Err(Error::ImporterInDefault);
    }
    let exposure = math::add(stats.open_exposure, terms.cost)?;
    if exposure > math::importer_limit(&cfg, &stats) {
        return Err(Error::LimitExceeded);
    }

    // Share token must be a correctly configured SAC administered by this contract.
    share::probe(env, &terms.share_token)?;

    // LIST attestation over the terms (traps if invalid).
    let payload = attest::list_payload_hash(env, &terms);
    attest::verify(env, PURPOSE_LIST, 0, &payload, &sig)?;

    let id = storage::next_deal_id(env);
    storage::set_next_deal_id(env, id.checked_add(1).ok_or(Error::Overflow)?);

    let deal = Deal {
        id,
        state: DealState::Listed,
        listed_at: now(env),
        funded: 0,
        supplier_paid: 0,
        owned_at: 0,
        bl_fingerprint: None,
        bl_report_hash: None,
        sale_price: 0,
        accepted_at: 0,
        due_at: 0,
        principal_repaid: 0,
        late_fee_due: 0,
        late_fee_paid: 0,
        recovered: 0,
        distributable: 0,
        claimed_shares: 0,
        paid_out: 0,
        holder_count: 0,
        security: terms.security,
        importer_at_fault: false,
        extended: false,
        terms: terms.clone(),
    };
    storage::put_deal(env, &deal);
    storage::set_deal_balance(env, id, 0);
    storage::mark_listing_fp(env, &terms.listing_fingerprint, id);
    storage::mark_share_token(env, &terms.share_token, id);

    promise.listed = true;
    storage::set_promise(env, &terms.listing_fingerprint, &promise);
    storage::add_inst_i128(env, &DataKey::PromiseHeld, -terms.security)?;

    let mut stats = stats;
    stats.open_exposure = exposure;
    storage::set_importer_stats(env, &terms.importer, &stats);

    DealListed {
        deal_id: id,
        importer: terms.importer,
        cost: terms.cost,
        markup: terms.markup,
        security: terms.security,
        share_token: terms.share_token,
        funding_deadline: terms.funding_deadline,
    }
    .publish(env);
    Ok(id)
}

// ------------------------------------------------------------------ funding

pub fn invest(env: &Env, investor: Address, deal_id: u64, amount: i128) -> Result<i128, Error> {
    require_not_paused(env)?;
    let mut deal = storage::get_deal(env, deal_id)?;
    if deal.state != DealState::Listed {
        return Err(Error::InvalidState);
    }
    investor.require_auth();
    if now(env) > deal.terms.funding_deadline {
        return Err(Error::FundingClosed);
    }
    if !storage::is_investor(env, &investor) || investor == deal.terms.importer {
        return Err(Error::NotApprovedInvestor);
    }
    if amount <= 0 {
        return Err(Error::InvalidAmount);
    }
    let remaining = math::sub(deal.terms.cost, deal.funded)?;
    if amount > remaining {
        return Err(Error::ExceedsRemaining);
    }
    let cfg = storage::config(env)?;
    if !storage::is_holder(env, deal_id, &investor) {
        if deal.holder_count >= cfg.max_investors_per_deal {
            return Err(Error::TooManyInvestors);
        }
        storage::set_holder_at(env, deal_id, deal.holder_count, &investor);
        storage::set_is_holder(env, deal_id, &investor);
        deal.holder_count = deal.holder_count.checked_add(1).ok_or(Error::Overflow)?;
    }
    deal.funded = math::add(deal.funded, amount)?;
    let complete = deal.funded == deal.terms.cost;
    if complete {
        deal.state = DealState::Funded;
    }
    storage::put_deal(env, &deal);
    storage::add_deal_balance(env, deal_id, amount)?;

    pull(env, &investor, amount)?;
    share::mint_locked(env, &deal.terms.share_token, &investor, amount);

    Invested {
        deal_id,
        investor: investor.clone(),
        amount,
        funded: deal.funded,
    }
    .publish(env);
    if complete {
        Funded {
            deal_id,
            funded: deal.funded,
        }
        .publish(env);
    }
    Ok(share::balance(env, &deal.terms.share_token, &investor))
}

/// Anyone; works while paused.
pub fn cancel_unfunded(env: &Env, deal_id: u64) -> Result<(), Error> {
    let mut deal = storage::get_deal(env, deal_id)?;
    if deal.state != DealState::Listed {
        return Err(Error::InvalidState);
    }
    if now(env) <= deal.terms.funding_deadline {
        return Err(Error::DeadlineNotPassed);
    }
    cancel(env, &mut deal)?;
    Ok(())
}

fn cancel(env: &Env, deal: &mut Deal) -> Result<(), Error> {
    deal.state = DealState::Cancelled;
    deal.distributable = storage::deal_balance(env, deal.id);
    refund_security(env, deal)?;
    storage::put_deal(env, deal);
    release_exposure(env, deal)?;
    Cancelled {
        deal_id: deal.id,
        distributable: deal.distributable,
    }
    .publish(env);
    Ok(())
}

// ----------------------------------------------------------------- purchase

pub fn pay_supplier_deposit(env: &Env, caller: Address, deal_id: u64) -> Result<i128, Error> {
    require_not_paused(env)?;
    let mut deal = storage::get_deal(env, deal_id)?;
    if deal.state != DealState::Funded {
        return Err(Error::InvalidState);
    }
    require_admin_or_agent(env, &caller)?;
    // In TrustlessWork mode `terms.supplier` is the escrow's funding address, so
    // the on-chain path is the same (PLAN 10.1, decided by SP10 off-chain).
    let deposit = math::bps_floor(deal.terms.cost, deal.terms.deposit_bps)?;
    deal.supplier_paid = math::add(deal.supplier_paid, deposit)?;
    deal.state = DealState::DepositPaid;
    storage::put_deal(env, &deal);
    storage::add_deal_balance(env, deal_id, -deposit)?;
    push(env, &deal.terms.supplier, deposit)?;
    DepositPaid {
        deal_id,
        supplier: deal.terms.supplier,
        amount: deposit,
    }
    .publish(env);
    Ok(deposit)
}

pub fn confirm_shipment(
    env: &Env,
    caller: Address,
    deal_id: u64,
    bl_fingerprint: BytesN<32>,
    bl_report_hash: BytesN<32>,
    sig: BytesN<64>,
) -> Result<i128, Error> {
    require_not_paused(env)?;
    let mut deal = storage::get_deal(env, deal_id)?;
    if deal.state != DealState::DepositPaid {
        return Err(Error::InvalidState);
    }
    require_admin_or_agent(env, &caller)?;
    if storage::has_bl_fp(env, &bl_fingerprint) {
        return Err(Error::BlFingerprintUsed);
    }
    let payload = attest::shipped_payload_hash(env, &bl_fingerprint, &bl_report_hash);
    attest::verify(env, PURPOSE_SHIPPED, deal_id, &payload, &sig)?;

    let balance = math::sub(deal.terms.cost, deal.supplier_paid)?;
    deal.supplier_paid = math::add(deal.supplier_paid, balance)?;
    deal.bl_fingerprint = Some(bl_fingerprint.clone());
    deal.bl_report_hash = Some(bl_report_hash.clone());
    deal.owned_at = now(env);
    deal.state = DealState::Owned;
    storage::put_deal(env, &deal);
    storage::mark_bl_fp(env, &bl_fingerprint, deal_id);
    storage::add_deal_balance(env, deal_id, -balance)?;
    push(env, &deal.terms.supplier, balance)?;
    ShipmentConfirmed {
        deal_id,
        bl_fingerprint,
        bl_report_hash,
        balance_paid: balance,
    }
    .publish(env);
    Ok(balance)
}

// --------------------------------------------------------------------- sale

pub fn accept_murabaha(env: &Env, deal_id: u64) -> Result<i128, Error> {
    require_not_paused(env)?;
    let mut deal = storage::get_deal(env, deal_id)?;
    if deal.state != DealState::Owned {
        return Err(Error::InvalidState);
    }
    deal.terms.importer.require_auth();
    let t = now(env);
    if t > deal.owned_at.saturating_add(deal.terms.accept_window_secs) {
        return Err(Error::AcceptWindowClosed);
    }
    deal.sale_price = math::add(deal.terms.cost, deal.terms.markup)?;
    deal.accepted_at = t;
    deal.due_at = t.saturating_add(deal.terms.tenor_secs);
    // The security deposit counts as the first payment of the price (FLOWS 8).
    let applied = deal.security;
    deal.principal_repaid = applied;
    deal.security = 0;
    deal.state = DealState::Sold;
    storage::put_deal(env, &deal);
    storage::add_deal_balance(env, deal_id, applied)?;
    MurabahaAccepted {
        deal_id,
        sale_price: deal.sale_price,
        due_at: deal.due_at,
    }
    .publish(env);
    SecurityApplied {
        deal_id,
        amount: applied,
    }
    .publish(env);
    Ok(deal.sale_price)
}

/// Returns the amount still outstanding after this payment.
pub fn repay(env: &Env, deal_id: u64, amount: i128) -> Result<i128, Error> {
    require_not_paused(env)?;
    let mut deal = storage::get_deal(env, deal_id)?;
    if deal.state != DealState::Sold {
        return Err(Error::InvalidState);
    }
    deal.terms.importer.require_auth();
    if amount <= 0 {
        return Err(Error::InvalidAmount);
    }
    let outstanding = math::sub(deal.sale_price, deal.principal_repaid)?;
    if amount > outstanding {
        return Err(Error::ExceedsRemaining);
    }
    deal.principal_repaid = math::add(deal.principal_repaid, amount)?;
    let complete = deal.principal_repaid == deal.sale_price;
    let late = now(env) > deal.due_at;
    storage::add_deal_balance(env, deal_id, amount)?;
    pull(env, &deal.terms.importer, amount)?;

    if complete {
        let mut stats = storage::importer_stats(env, &deal.terms.importer);
        if late {
            deal.late_fee_due = deal.terms.late_fee;
            stats.late = stats.late.checked_add(1).ok_or(Error::Overflow)?;
        } else if !deal.extended {
            stats.on_time = stats.on_time.checked_add(1).ok_or(Error::Overflow)?;
        }
        // An extended deal paid before the new date counts as neither.
        stats.total_repaid = math::add(stats.total_repaid, deal.sale_price)?;
        stats.open_exposure = math::sub(stats.open_exposure, deal.terms.cost)?;
        if stats.open_exposure < 0 {
            stats.open_exposure = 0;
        }
        storage::set_importer_stats(env, &deal.terms.importer, &stats);

        let fee = deal.terms.platform_fee;
        storage::add_inst_i128(env, &DataKey::TreasuryOwed, fee)?;
        let balance = storage::add_deal_balance(env, deal_id, -fee)?;
        deal.distributable = balance;
        deal.state = DealState::Repaid;
    }
    storage::put_deal(env, &deal);
    Repaid {
        deal_id,
        amount,
        principal_repaid: deal.principal_repaid,
        complete,
        late: complete && late,
    }
    .publish(env);
    math::sub(deal.sale_price, deal.principal_repaid)
}

pub fn pay_late_fee(env: &Env, deal_id: u64, amount: i128) -> Result<(), Error> {
    require_not_paused(env)?;
    let mut deal = storage::get_deal(env, deal_id)?;
    if deal.state != DealState::Repaid && deal.state != DealState::Closed {
        return Err(Error::InvalidState);
    }
    let outstanding = math::sub(deal.late_fee_due, deal.late_fee_paid)?;
    if outstanding <= 0 {
        return Err(Error::InvalidState);
    }
    deal.terms.importer.require_auth();
    if amount <= 0 {
        return Err(Error::InvalidAmount);
    }
    if amount > outstanding {
        return Err(Error::ExceedsRemaining);
    }
    deal.late_fee_paid = math::add(deal.late_fee_paid, amount)?;
    storage::put_deal(env, &deal);
    storage::add_inst_i128(env, &DataKey::CharityOwed, amount)?;
    pull(env, &deal.terms.importer, amount)?;
    LateFeeToCharity { deal_id, amount }.publish(env);
    Ok(())
}

/// One extension per deal, price unchanged (FLOWS 8).
pub fn extend_due(env: &Env, deal_id: u64, new_due_at: u64) -> Result<(), Error> {
    require_not_paused(env)?;
    let mut deal = storage::get_deal(env, deal_id)?;
    if deal.state != DealState::Sold {
        return Err(Error::InvalidState);
    }
    require_admin(env)?;
    if deal.extended {
        return Err(Error::AlreadyExtended);
    }
    let cfg = storage::config(env)?;
    let max = deal.due_at.saturating_add(cfg.max_extension_secs);
    if new_due_at <= deal.due_at || new_due_at > max {
        return Err(Error::InvalidDueDate);
    }
    let old = deal.due_at;
    deal.due_at = new_due_at;
    deal.extended = true;
    storage::put_deal(env, &deal);
    DueExtended {
        deal_id,
        old_due_at: old,
        new_due_at,
    }
    .publish(env);
    Ok(())
}

// ------------------------------------------------------------ abort, default

pub fn abort_deal(env: &Env, deal_id: u64, importer_at_fault: bool) -> Result<(), Error> {
    require_not_paused(env)?;
    let mut deal = storage::get_deal(env, deal_id)?;
    let from = deal.state;
    match from {
        DealState::Listed | DealState::Funded => {
            require_admin(env)?;
            cancel(env, &mut deal)?;
        }
        DealState::DepositPaid | DealState::Owned => {
            require_admin(env)?;
            deal.state = DealState::Defaulted;
            deal.importer_at_fault = importer_at_fault;
            if importer_at_fault {
                let mut stats = storage::importer_stats(env, &deal.terms.importer);
                stats.defaulted = stats.defaulted.checked_add(1).ok_or(Error::Overflow)?;
                storage::set_importer_stats(env, &deal.terms.importer, &stats);
            } else {
                refund_security(env, &mut deal)?;
            }
            storage::put_deal(env, &deal);
        }
        _ => return Err(Error::InvalidState),
    }
    Aborted {
        deal_id,
        importer_at_fault,
        from_state: math::state_index(from),
    }
    .publish(env);
    Ok(())
}

pub fn mark_default(env: &Env, deal_id: u64) -> Result<(), Error> {
    require_not_paused(env)?;
    let mut deal = storage::get_deal(env, deal_id)?;
    if deal.state != DealState::Sold {
        return Err(Error::InvalidState);
    }
    require_admin(env)?;
    let cfg = storage::config(env)?;
    if now(env) <= deal.due_at.saturating_add(cfg.grace_secs) {
        return Err(Error::DueNotPassed);
    }
    deal.state = DealState::Defaulted;
    deal.importer_at_fault = true;
    storage::put_deal(env, &deal);
    let mut stats = storage::importer_stats(env, &deal.terms.importer);
    stats.defaulted = stats.defaulted.checked_add(1).ok_or(Error::Overflow)?;
    storage::set_importer_stats(env, &deal.terms.importer, &stats);
    Defaulted { deal_id }.publish(env);
    Ok(())
}

pub fn deposit_recovery(env: &Env, deal_id: u64, from: Address, amount: i128) -> Result<(), Error> {
    require_not_paused(env)?;
    let mut deal = storage::get_deal(env, deal_id)?;
    if deal.state != DealState::Defaulted {
        return Err(Error::InvalidState);
    }
    require_admin(env)?;
    from.require_auth();
    if amount <= 0 {
        return Err(Error::InvalidAmount);
    }
    if deal.sale_price > 0 {
        // The importer never pays more than the price (FLOWS 8, invariant 12).
        let paid = math::add(deal.principal_repaid, deal.recovered)?;
        if math::add(paid, amount)? > deal.sale_price {
            return Err(Error::ExceedsRemaining);
        }
    }
    deal.recovered = math::add(deal.recovered, amount)?;
    storage::put_deal(env, &deal);
    storage::add_deal_balance(env, deal_id, amount)?;
    pull(env, &from, amount)?;
    Recovery {
        deal_id,
        from,
        amount,
    }
    .publish(env);
    Ok(())
}

pub fn finalize_default(env: &Env, deal_id: u64) -> Result<(), Error> {
    require_not_paused(env)?;
    let mut deal = storage::get_deal(env, deal_id)?;
    if deal.state != DealState::Defaulted {
        return Err(Error::InvalidState);
    }
    require_admin(env)?;
    if deal.sale_price == 0 && deal.security > 0 {
        // Only the actual loss comes out of the security deposit (FLOWS 8).
        let balance = storage::deal_balance(env, deal_id);
        let loss = math::sub(deal.funded, balance)?.max(0);
        let used = deal.security.min(loss);
        let refunded = math::sub(deal.security, used)?;
        storage::add_deal_balance(env, deal_id, used)?;
        credit_refund(env, &deal.terms.importer, refunded, deal_id)?;
        deal.security = 0;
        SecurityUsed {
            deal_id,
            used,
            refunded,
        }
        .publish(env);
    }
    deal.distributable = storage::deal_balance(env, deal_id);
    deal.state = DealState::Liquidated;
    storage::put_deal(env, &deal);
    release_exposure(env, &deal)?;
    Liquidated {
        deal_id,
        distributable: deal.distributable,
    }
    .publish(env);
    Ok(())
}

// ------------------------------------------------------------------- payout

fn claimable(state: DealState) -> bool {
    matches!(
        state,
        DealState::Repaid | DealState::Cancelled | DealState::Liquidated
    )
}

/// Anyone may call; pays `holder`. Works while paused.
pub fn claim(env: &Env, holder: Address, deal_id: u64) -> Result<i128, Error> {
    let mut deal = storage::get_deal(env, deal_id)?;
    if !claimable(deal.state) {
        return Err(Error::InvalidState);
    }
    // Only shares minted by `invest` are claimable: the holder must be in the deal's
    // index and the claimed total can never exceed what was funded (review finding 1).
    if !storage::is_holder(env, deal_id, &holder) {
        return Err(Error::NothingToClaim);
    }
    let shares = share::balance(env, &deal.terms.share_token, &holder);
    if shares <= 0 {
        return Err(Error::NothingToClaim);
    }
    let payout = math::payout(shares, deal.distributable, deal.funded)?;
    deal.claimed_shares = math::add(deal.claimed_shares, shares)?;
    if deal.claimed_shares > deal.funded {
        return Err(Error::InvalidState);
    }
    deal.paid_out = math::add(deal.paid_out, payout)?;
    storage::put_deal(env, &deal);
    storage::add_deal_balance(env, deal_id, -payout)?;
    share::clawback(env, &deal.terms.share_token, &holder, shares);
    push(env, &holder, payout)?;
    Claimed {
        deal_id,
        holder,
        shares,
        payout,
    }
    .publish(env);
    Ok(payout)
}

/// Anyone may call; pays `addr` its refunds. Works while paused.
pub fn withdraw_refund(env: &Env, addr: Address) -> Result<i128, Error> {
    let amount = storage::refund_of(env, &addr);
    if amount <= 0 {
        return Err(Error::NothingToRefund);
    }
    storage::set_refund(env, &addr, 0);
    storage::add_inst_i128(env, &DataKey::RefundsOwed, -amount)?;
    push(env, &addr, amount)?;
    Refunded { to: addr, amount }.publish(env);
    Ok(amount)
}

/// Anyone; works while paused. Rounding dust goes to charity.
pub fn close_deal(env: &Env, deal_id: u64) -> Result<(), Error> {
    let mut deal = storage::get_deal(env, deal_id)?;
    if !claimable(deal.state) || deal.claimed_shares != deal.funded {
        return Err(Error::InvalidState);
    }
    let dust = storage::deal_balance(env, deal_id);
    storage::set_deal_balance(env, deal_id, 0);
    storage::add_inst_i128(env, &DataKey::CharityOwed, dust)?;
    deal.state = DealState::Closed;
    storage::put_deal(env, &deal);
    Closed {
        deal_id,
        dust_to_charity: dust,
    }
    .publish(env);
    Ok(())
}

pub fn sweep(env: &Env, kind: u32) -> Result<i128, Error> {
    let (key, to) = if kind == 1 {
        (DataKey::CharityOwed, storage::charity(env)?)
    } else {
        (DataKey::TreasuryOwed, storage::treasury(env)?)
    };
    let amount = storage::inst_i128(env, &key);
    if amount <= 0 {
        return Ok(0);
    }
    storage::set_inst_i128(env, &key, 0);
    push(env, &to, amount)?;
    Swept { to, kind, amount }.publish(env);
    Ok(amount)
}

// -------------------------------------------------------------------- views

pub fn holders(env: &Env, deal_id: u64, start: u32, limit: u32) -> Result<Vec<Address>, Error> {
    if limit > MAX_HOLDERS_PAGE {
        return Err(Error::InvalidAmount);
    }
    let deal = storage::get_deal(env, deal_id)?;
    let end = start.saturating_add(limit).min(deal.holder_count);
    let mut out = Vec::new(env);
    let mut i = start;
    while i < end {
        if let Some(h) = storage::holder_at(env, deal_id, i) {
            out.push_back(h);
        }
        i += 1;
    }
    Ok(out)
}

pub fn quote_claim(env: &Env, holder: Address, deal_id: u64) -> Result<i128, Error> {
    let deal = storage::get_deal(env, deal_id)?;
    if !claimable(deal.state) {
        return Ok(0);
    }
    let shares = share::balance(env, &deal.terms.share_token, &holder);
    math::payout(shares, deal.distributable, deal.funded)
}
