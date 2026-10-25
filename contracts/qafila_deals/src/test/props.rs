//! Property tests for invariants 1, 2, 3, 8, 9 and 11 to 15 (PLAN 3.3.5, FLOWS 8)
//! over random investor counts, amounts, repayment schedules and outcomes,
//! including promises, withdrawals, cancels, aborts and refunds.
use super::*;
use proptest::prelude::*;

#[derive(Debug, Clone)]
enum Outcome {
    WithdrawPromise,
    CancelUnfunded,
    AbortListed,
    AbortFunded,
    SupplierVanished { recovery: i128 },
    GoodsLost { recovery: i128 },
    PromiseBroken { resale: i128 },
    RepayOnTime { extend: bool },
    RepayLate,
    SoldDefault { paid: i128, recovery: i128 },
}

fn outcome() -> impl Strategy<Value = Outcome> {
    prop_oneof![
        Just(Outcome::WithdrawPromise),
        Just(Outcome::CancelUnfunded),
        Just(Outcome::AbortListed),
        Just(Outcome::AbortFunded),
        (0i128..=4_000).prop_map(|r| Outcome::SupplierVanished { recovery: r * ONE }),
        (0i128..=12_000).prop_map(|r| Outcome::GoodsLost { recovery: r * ONE }),
        (0i128..=11_000).prop_map(|r| Outcome::PromiseBroken { resale: r * ONE }),
        any::<bool>().prop_map(|e| Outcome::RepayOnTime { extend: e }),
        Just(Outcome::RepayLate),
        (0i128..=8_800, 0i128..=9_000).prop_map(|(p, r)| Outcome::SoldDefault {
            paid: p * ONE,
            recovery: r * ONE
        }),
    ]
}

struct Run {
    w: World,
    id: u64,
    holders: std::vec::Vec<Address>,
    security: i128,
}

impl Run {
    fn check_all(&self) {
        self.w.assert_books_balance(&[self.id]);
        self.w.assert_share_supply(self.id);
        let d = self.w.client().get_deal(&self.id);
        assert!(d.paid_out <= d.distributable, "invariant 2a");
        assert!(d.terms.platform_fee <= d.terms.markup, "invariant 8a");
        if d.sale_price > 0 {
            assert_eq!(d.sale_price, COST + MARKUP, "invariant 4/13");
            assert!(
                d.principal_repaid + d.recovered <= d.sale_price,
                "invariant 12"
            );
        }
        if matches!(
            d.state,
            DealState::Repaid | DealState::Cancelled | DealState::Liquidated | DealState::Closed
        ) {
            assert_eq!(d.security, 0, "invariant 15");
        }
        if matches!(
            d.state,
            DealState::Repaid | DealState::Cancelled | DealState::Liquidated
        ) && d.paid_out == 0
        {
            assert_eq!(d.distributable, self.w.deal_balance(self.id), "invariant 9");
        }
        // Invariant 14: refunds only ever belong to the importer.
        for h in &self.holders {
            assert_eq!(self.w.client().refund_of(h), 0, "invariant 14");
        }
        assert_eq!(
            self.w.client().refund_of(&self.w.supplier),
            0,
            "invariant 14"
        );
    }

    fn claim_close(&self) {
        let c = self.w.client();
        let before = c.get_deal(&self.id);
        let mut total = 0;
        for h in &self.holders {
            if self.w.share_balance(&before.terms.share_token, h) > 0 {
                total += c.claim(h, &self.id);
            }
            self.check_all();
        }
        let d = c.get_deal(&self.id);
        assert_eq!(d.paid_out, total);
        assert!(
            d.distributable - d.paid_out < i128::from(d.holder_count.max(1)),
            "invariant 2b"
        );
        if d.state == DealState::Repaid {
            assert!(
                d.distributable >= d.funded,
                "invariant 8b: at least principal"
            );
        }
        c.close_deal(&self.id);
        self.check_all();
        if c.refund_of(&self.w.importer) > 0 {
            c.withdraw_refund(&self.w.importer);
        }
        c.sweep_charity();
        c.sweep_treasury();
        self.check_all();
        let owed = c.owed();
        assert_eq!(
            owed.charity + owed.treasury + owed.refunds + owed.promises_held,
            0
        );
        assert_eq!(self.w.contract_balance(), 0, "nothing stranded");
    }
}

fn recover(r: &Run, amount: i128) {
    if amount <= 0 {
        return;
    }
    let who = Address::generate(&r.w.env);
    r.w.mint(&who, amount);
    let d = r.w.client().get_deal(&r.id);
    if d.sale_price > 0 && d.principal_repaid + d.recovered + amount > d.sale_price {
        assert!(r
            .w
            .client()
            .try_deposit_recovery(&r.id, &who, &amount)
            .is_err());
        let room = d.sale_price - d.principal_repaid - d.recovered;
        if room > 0 {
            r.w.client().deposit_recovery(&r.id, &who, &room);
        }
    } else {
        r.w.client().deposit_recovery(&r.id, &who, &amount);
    }
    r.check_all();
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 12, max_shrink_iters: 0, .. ProptestConfig::default() })]

    #[test]
    fn deal_invariants_hold(
        amounts in prop::collection::vec(1i128..=10_000, 1..6),
        extra_security in 0i128..=7_000,
        parts in prop::collection::vec(1i128..=9_000, 1..5),
        out in outcome(),
    ) {
        let w = World::new();
        let security = SECURITY + extra_security * ONE; // < cost
        let fp = w.fp(1);
        w.promise(&fp, security);
        w.assert_books_balance(&[]);
        if matches!(out, Outcome::WithdrawPromise) {
            prop_assert_eq!(w.client().withdraw_promise(&w.importer, &fp), security);
            prop_assert_eq!(w.contract_balance(), 0);
            return Ok(());
        }
        let mut terms = w.terms(&w.new_share(), &fp);
        terms.security = security;
        let id = w.client().list_deal(&terms, &w.sign_list(&terms));
        let mut r = Run { w, id, holders: std::vec![], security };
        let c = r.w.client();
        r.check_all();

        // Fund with random amounts, capped at what is left.
        let mut remaining = COST;
        for a in &amounts {
            if remaining == 0 { break; }
            let amt = (a * ONE).min(remaining);
            let inv = r.w.new_investor(amt);
            c.invest(&inv, &id, &amt);
            r.holders.push(inv);
            remaining -= amt;
            r.check_all();
        }
        let funded = remaining == 0;

        match out {
            Outcome::WithdrawPromise => unreachable!(),
            Outcome::CancelUnfunded => {
                if funded {
                    // A funded deal cannot be cancelled; ops aborts instead.
                    prop_assert!(c.try_cancel_unfunded(&id).is_err());
                    c.abort_deal(&id, &false);
                } else {
                    r.w.advance(FUNDING_WINDOW + 1);
                    c.cancel_unfunded(&id);
                }
                prop_assert_eq!(c.refund_of(&r.w.importer), security);
            }
            Outcome::AbortListed | Outcome::AbortFunded => {
                c.abort_deal(&id, &true);
                prop_assert_eq!(c.get_deal(&id).state, DealState::Cancelled);
                prop_assert_eq!(c.refund_of(&r.w.importer), security);
                prop_assert_eq!(c.importer_stats(&r.w.importer).defaulted, 0);
            }
            _ if !funded => {
                r.w.advance(FUNDING_WINDOW + 1);
                c.cancel_unfunded(&id);
            }
            Outcome::SupplierVanished { recovery } => {
                c.pay_supplier_deposit(&r.w.agent, &id);
                r.check_all();
                let balance_before = r.w.deal_balance(id);
                c.abort_deal(&id, &true);
                r.check_all();
                recover(&r, recovery);
                let bal = r.w.deal_balance(id);
                c.finalize_default(&id);
                let d = c.get_deal(&id);
                let loss = (COST - bal).max(0);
                let used = security.min(loss);
                prop_assert!(used <= (COST - bal).max(0), "invariant 11");
                prop_assert_eq!(d.distributable, bal + used);
                prop_assert_eq!(c.refund_of(&r.w.importer), security - used);
                prop_assert!(balance_before >= bal - recovery.max(0));
            }
            Outcome::GoodsLost { recovery } => {
                c.pay_supplier_deposit(&r.w.agent, &id);
                r.w.ship(id, 1);
                c.abort_deal(&id, &false);
                prop_assert_eq!(c.refund_of(&r.w.importer), security);
                recover(&r, recovery);
                c.finalize_default(&id);
                prop_assert_eq!(c.get_deal(&id).distributable, recovery);
            }
            Outcome::PromiseBroken { resale } => {
                c.pay_supplier_deposit(&r.w.agent, &id);
                r.w.ship(id, 1);
                c.abort_deal(&id, &true);
                recover(&r, resale);
                c.finalize_default(&id);
                let d = c.get_deal(&id);
                let loss = (COST - resale).max(0);
                let used = security.min(loss);
                prop_assert_eq!(d.distributable, resale + used);
                prop_assert_eq!(c.refund_of(&r.w.importer), security - used);
            }
            Outcome::RepayOnTime { extend } => {
                c.pay_supplier_deposit(&r.w.agent, &id);
                r.w.ship(id, 1);
                c.accept_murabaha(&id);
                r.check_all();
                let d = c.get_deal(&id);
                prop_assert_eq!(d.principal_repaid, security);
                if extend {
                    c.extend_due(&id, &(d.due_at + 600));
                    prop_assert!(c.try_extend_due(&id, &(d.due_at + 300)).is_err());
                    prop_assert_eq!(c.get_deal(&id).sale_price, COST + MARKUP, "invariant 13");
                }
                let mut outstanding = COST + MARKUP - security;
                r.w.mint(&r.w.importer, outstanding);
                for p in &parts {
                    if outstanding == 0 { break; }
                    let amt = (p * ONE).min(outstanding);
                    outstanding = c.repay(&id, &amt);
                    r.check_all();
                }
                if outstanding > 0 {
                    c.repay(&id, &outstanding);
                }
                let d = c.get_deal(&id);
                prop_assert_eq!(d.state, DealState::Repaid);
                prop_assert_eq!(d.late_fee_due, 0);
                prop_assert_eq!(d.distributable, COST + MARKUP - FEE);
                prop_assert_eq!(c.owed().treasury, FEE);
                let s = c.importer_stats(&r.w.importer);
                prop_assert_eq!(s.on_time, u32::from(!extend));
            }
            Outcome::RepayLate => {
                c.pay_supplier_deposit(&r.w.agent, &id);
                r.w.ship(id, 1);
                c.accept_murabaha(&id);
                r.w.advance(TENOR + 1);
                let outstanding = COST + MARKUP - security;
                r.w.mint(&r.w.importer, outstanding + LATE_FEE);
                c.repay(&id, &outstanding);
                let d = c.get_deal(&id);
                prop_assert_eq!(d.late_fee_due, LATE_FEE);
                prop_assert_eq!(d.distributable, COST + MARKUP - FEE);
                c.pay_late_fee(&id, &LATE_FEE);
                prop_assert_eq!(c.owed().charity, LATE_FEE, "invariant 5");
                prop_assert_eq!(c.owed().treasury, FEE);
            }
            Outcome::SoldDefault { paid, recovery } => {
                c.pay_supplier_deposit(&r.w.agent, &id);
                r.w.ship(id, 1);
                c.accept_murabaha(&id);
                let outstanding = COST + MARKUP - security;
                let paid = paid.min(outstanding - 1).max(0);
                if paid > 0 {
                    r.w.mint(&r.w.importer, paid);
                    c.repay(&id, &paid);
                }
                let d = c.get_deal(&id);
                r.w.set_time(d.due_at + 61);
                c.mark_default(&id);
                recover(&r, recovery);
                c.finalize_default(&id);
                let d = c.get_deal(&id);
                prop_assert!(d.principal_repaid + d.recovered <= d.sale_price, "invariant 12");
                prop_assert_eq!(d.distributable, security + paid + d.recovered);
                prop_assert_eq!(c.owed().treasury, 0);
                prop_assert_eq!(c.importer_limit(&r.w.importer), 0);
            }
        }
        r.check_all();
        r.claim_close();
        let _ = r.security;
    }
}
