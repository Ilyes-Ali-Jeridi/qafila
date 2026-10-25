use soroban_sdk::contracterror;

/// Error codes are public ABI. Never renumber.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotAuthorized = 2,
    Paused = 3,
    DealNotFound = 4,
    InvalidState = 5,
    InvalidAmount = 6,
    ExceedsRemaining = 7,
    InvalidTerms = 8,
    NotApprovedInvestor = 9,
    NoPromise = 10,
    PromiseMismatch = 11,
    ListingFingerprintUsed = 12,
    BlFingerprintUsed = 13,
    ShareTokenUsed = 14,
    ShareTokenProbeFailed = 15,
    MarkupTooHigh = 16,
    FeeExceedsMarkup = 17,
    DepositTooHigh = 18,
    TenorTooShort = 19,
    NotHalal = 20,
    FundingClosed = 21,
    DeadlineNotPassed = 22,
    AcceptWindowClosed = 23,
    DueNotPassed = 24,
    TooManyInvestors = 25,
    LimitExceeded = 26,
    ImporterInDefault = 27,
    NothingToClaim = 28,
    Overflow = 29,
    // v1.1 (docs/FLOWS.md section 8)
    SecurityTooLow = 30,
    SecurityTooHigh = 31,
    PromiseExists = 32,
    PromiseListed = 33,
    NothingToRefund = 34,
    InvalidDueDate = 35,
    AlreadyExtended = 36,
}
