//! Test world shared by every suite (PLAN 3.3.7 + FLOWS 8 tests).
//! Worked amounts: cost 10,000, markup 800, fee 200, 30% supplier deposit,
//! security 2,000; outcomes 10,600 / 9,000 / 10,000 / 7,500.
extern crate std;

use ed25519_dalek::{Signer, SigningKey};
use soroban_sdk::{
    testutils::{Address as _, IssuerFlags, Ledger as _},
    token::{StellarAssetClient, TokenClient},
    xdr::ToXdr,
    Address, BytesN, Env,
};

use crate::{attest, storage, types::*, QafilaDeals, QafilaDealsClient};

mod attest_tests;
mod auth;
mod cancel;
mod default;
mod freeze;
mod lifecycle;
mod math_tests;
mod props;

pub const ONE: i128 = 10_000_000;
pub const COST: i128 = 10_000 * ONE;
pub const MARKUP: i128 = 800 * ONE;
pub const FEE: i128 = 200 * ONE;
pub const LATE_FEE: i128 = 50 * ONE;
pub const DEPOSIT_BPS: u32 = 3000;
pub const SECURITY: i128 = 2_000 * ONE;
pub const TENOR: u64 = 90 * 86_400;
pub const ACCEPT_WINDOW: u64 = 7 * 86_400;
pub const FUNDING_WINDOW: u64 = 14 * 86_400;
pub const T0: u64 = 1_760_000_000;
pub const TESTNET_PASSPHRASE: &str = "Test SDF Network ; September 2015";

pub fn config() -> Config {
    Config {
        max_markup_bps: 1500,
        max_deposit_bps: 3000,
        max_investors_per_deal: 100,
        min_tenor_secs: 60,
        grace_secs: 60,
        base_importer_limit: 200_000 * ONE,
        limit_step: 10_000 * ONE,
        min_security_bps: 2000,
        security_step_bps: 250,
        security_floor_bps: 1000,
        max_extension_secs: 600,
    }
}

pub struct World {
    pub env: Env,
    pub contract: Address,
    pub admin: Address,
    pub agent: Address,
    pub charity: Address,
    pub treasury: Address,
    pub settlement: Address,
    pub importer: Address,
    pub supplier: Address,
    pub verifier: SigningKey,
}

pub fn signing_key(seed: u8) -> SigningKey {
    SigningKey::from_bytes(&[seed; 32])
}

pub fn pk_bytes(env: &Env, key: &SigningKey) -> BytesN<32> {
    BytesN::from_array(env, &key.verifying_key().to_bytes())
}

impl World {
    pub fn new() -> World {
        Self::with_config(config())
    }

    pub fn with_config(cfg: Config) -> World {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(T0);
        let admin = Address::generate(&env);
        let agent = Address::generate(&env);
        let charity = Address::generate(&env);
        let treasury = Address::generate(&env);
        let importer = Address::generate(&env);
        let supplier = Address::generate(&env);
        let settlement_admin = Address::generate(&env);
        let settlement = env
            .register_stellar_asset_contract_v2(settlement_admin)
            .address();
        let verifier = signing_key(0x51);
        let contract = env.register(
            QafilaDeals,
            (
                admin.clone(),
                pk_bytes(&env, &verifier),
                charity.clone(),
                treasury.clone(),
                settlement.clone(),
                cfg,
            ),
        );
        let w = World {
            env,
            contract,
            admin,
            agent,
            charity,
            treasury,
            settlement,
            importer,
            supplier,
            verifier,
        };
        w.client().set_agent(&w.agent);
        w
    }

    pub fn client(&self) -> QafilaDealsClient<'_> {
        QafilaDealsClient::new(&self.env, &self.contract)
    }

    pub fn now(&self) -> u64 {
        self.env.ledger().timestamp()
    }

    pub fn set_time(&self, t: u64) {
        self.env.ledger().set_timestamp(t);
    }

    pub fn advance(&self, secs: u64) {
        self.set_time(self.now() + secs);
    }

    // ------------------------------------------------------------ tokens

    pub fn mint(&self, to: &Address, amount: i128) {
        StellarAssetClient::new(&self.env, &self.settlement).mint(to, &amount);
    }

    pub fn balance(&self, who: &Address) -> i128 {
        TokenClient::new(&self.env, &self.settlement).balance(who)
    }

    pub fn contract_balance(&self) -> i128 {
        self.balance(&self.contract)
    }

    pub fn share_balance(&self, share: &Address, who: &Address) -> i128 {
        TokenClient::new(&self.env, share).balance(who)
    }

    /// A share SAC with the three flags, admin handed to the contract (PLAN 3.1).
    pub fn new_share(&self) -> Address {
        self.new_share_with(&[
            IssuerFlags::RequiredFlag,
            IssuerFlags::RevocableFlag,
            IssuerFlags::ClawbackEnabledFlag,
        ])
    }

    pub fn new_share_with(&self, flags: &[IssuerFlags]) -> Address {
        let issuer_admin = Address::generate(&self.env);
        let sac = self.env.register_stellar_asset_contract_v2(issuer_admin);
        for f in flags {
            sac.issuer().set_flag(*f);
        }
        StellarAssetClient::new(&self.env, &sac.address()).set_admin(&self.contract);
        sac.address()
    }

    pub fn new_investor(&self, funds: i128) -> Address {
        let a = Address::generate(&self.env);
        self.client().approve_investor(&a);
        self.mint(&a, funds);
        a
    }

    // ------------------------------------------------------------- terms

    pub fn fp(&self, n: u8) -> BytesN<32> {
        BytesN::from_array(&self.env, &[n; 32])
    }

    pub fn terms(&self, share: &Address, fp: &BytesN<32>) -> DealTerms {
        DealTerms {
            importer: self.importer.clone(),
            supplier: self.supplier.clone(),
            share_token: share.clone(),
            payout_token: self.settlement.clone(),
            cost: COST,
            deposit_bps: DEPOSIT_BPS,
            markup: MARKUP,
            platform_fee: FEE,
            late_fee: LATE_FEE,
            funding_deadline: self.now() + FUNDING_WINDOW,
            accept_window_secs: ACCEPT_WINDOW,
            tenor_secs: TENOR,
            listing_fingerprint: fp.clone(),
            report_hash: BytesN::from_array(&self.env, &[0xAA; 32]),
            promise_hash: BytesN::from_array(&self.env, &[0xBB; 32]),
            halal_ok: true,
            payment_mode: PaymentMode::Native,
            security: SECURITY,
        }
    }

    // ------------------------------------------------------- attestations

    pub fn message(&self, purpose: u32, deal_id: u64, payload: &BytesN<32>) -> std::vec::Vec<u8> {
        self.env.as_contract(&self.contract, || {
            attest::message(&self.env, purpose, deal_id, payload)
                .iter()
                .collect()
        })
    }

    pub fn sign_with(
        &self,
        key: &SigningKey,
        purpose: u32,
        deal_id: u64,
        payload: &BytesN<32>,
    ) -> BytesN<64> {
        let msg = self.message(purpose, deal_id, payload);
        BytesN::from_array(&self.env, &key.sign(&msg).to_bytes())
    }

    pub fn sign(&self, purpose: u32, deal_id: u64, payload: &BytesN<32>) -> BytesN<64> {
        self.sign_with(&self.verifier, purpose, deal_id, payload)
    }

    pub fn list_payload(&self, terms: &DealTerms) -> BytesN<32> {
        self.env.as_contract(&self.contract, || {
            attest::list_payload_hash(&self.env, terms)
        })
    }

    pub fn sign_list(&self, terms: &DealTerms) -> BytesN<64> {
        self.sign(PURPOSE_LIST, 0, &self.list_payload(terms))
    }

    pub fn shipped_payload(&self, bl_fp: &BytesN<32>, bl_report: &BytesN<32>) -> BytesN<32> {
        self.env.as_contract(&self.contract, || {
            attest::shipped_payload_hash(&self.env, bl_fp, bl_report)
        })
    }

    pub fn sign_shipped(
        &self,
        deal_id: u64,
        bl_fp: &BytesN<32>,
        bl_report: &BytesN<32>,
    ) -> BytesN<64> {
        self.sign(
            PURPOSE_SHIPPED,
            deal_id,
            &self.shipped_payload(bl_fp, bl_report),
        )
    }

    pub fn contract_xdr(&self) -> std::vec::Vec<u8> {
        self.env.as_contract(&self.contract, || {
            self.contract.clone().to_xdr(&self.env).iter().collect()
        })
    }

    // ---------------------------------------------------------- lifecycle

    /// Mint the security to the importer and sign the promise.
    pub fn promise(&self, fp: &BytesN<32>, security: i128) {
        self.mint(&self.importer, security);
        self.client().promise_purchase(
            &self.importer,
            fp,
            &BytesN::from_array(&self.env, &[0xBB; 32]),
            &security,
        );
    }

    /// Promise + list with the worked terms. Returns (deal id, terms).
    pub fn list(&self, n: u8) -> (u64, DealTerms) {
        let fp = self.fp(n);
        self.promise(&fp, SECURITY);
        let share = self.new_share();
        let terms = self.terms(&share, &fp);
        let id = self.client().list_deal(&terms, &self.sign_list(&terms));
        (id, terms)
    }

    /// Three investors fund the deal fully: 5,000 / 3,000 / 2,000.
    pub fn fund(&self, deal_id: u64) -> [Address; 3] {
        let a = self.new_investor(5_000 * ONE);
        let b = self.new_investor(3_000 * ONE);
        let c = self.new_investor(2_000 * ONE);
        self.client().invest(&a, &deal_id, &(5_000 * ONE));
        self.client().invest(&b, &deal_id, &(3_000 * ONE));
        self.client().invest(&c, &deal_id, &(2_000 * ONE));
        [a, b, c]
    }

    pub fn ship(&self, deal_id: u64, n: u8) {
        let bl_fp = self.fp(0xC0 + n);
        let bl_report = self.fp(0xD0 + n);
        let sig = self.sign_shipped(deal_id, &bl_fp, &bl_report);
        self.client()
            .confirm_shipment(&self.agent, &deal_id, &bl_fp, &bl_report, &sig);
    }

    /// List, fund, deposit, ship: the deal owns the goods.
    pub fn owned(&self, n: u8) -> (u64, DealTerms, [Address; 3]) {
        let (id, terms) = self.list(n);
        let inv = self.fund(id);
        self.client().pay_supplier_deposit(&self.agent, &id);
        self.ship(id, n);
        (id, terms, inv)
    }

    /// Owned, then the importer accepts the sale.
    pub fn sold(&self, n: u8) -> (u64, DealTerms, [Address; 3]) {
        let (id, terms, inv) = self.owned(n);
        self.client().accept_murabaha(&id);
        (id, terms, inv)
    }

    pub fn claim_all(&self, deal_id: u64, holders: &[Address]) -> i128 {
        let mut total = 0;
        for h in holders {
            total += self.client().claim(h, &deal_id);
        }
        total
    }

    // --------------------------------------------------------- invariants

    pub fn deal_balance(&self, deal_id: u64) -> i128 {
        self.env
            .as_contract(&self.contract, || storage::deal_balance(&self.env, deal_id))
    }

    /// Invariant 1 (FLOWS 8): sum DealBalance + sum security + PromiseHeld +
    /// RefundsOwed + CharityOwed + TreasuryOwed == contract token balance.
    pub fn assert_books_balance(&self, deal_ids: &[u64]) {
        let owed = self.client().owed();
        let mut sum = owed.charity + owed.treasury + owed.refunds + owed.promises_held;
        for id in deal_ids {
            sum += self.deal_balance(*id);
            sum += self.client().get_deal(id).security;
        }
        assert_eq!(
            sum,
            self.contract_balance(),
            "invariant 1 (books vs token balance)"
        );
    }

    /// Invariant 3: sum of share balances over the holder index == funded - claimed.
    pub fn assert_share_supply(&self, deal_id: u64) {
        let deal = self.client().get_deal(&deal_id);
        let holders = self.client().holders(&deal_id, &0, &50);
        let mut sum = 0;
        for h in holders.iter() {
            sum += self.share_balance(&deal.terms.share_token, &h);
        }
        assert_eq!(
            sum,
            deal.funded - deal.claimed_shares,
            "invariant 3 (share supply)"
        );
    }
}
