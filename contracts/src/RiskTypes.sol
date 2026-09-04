// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Risk taxonomy emitted by the pre-sign engine.
library RiskTypes {
    enum RiskKind {
        UNLIMITED_APPROVAL,      // approve/permit with type(uint256).max or huge amount
        APPROVE_TO_EOA,          // approval whose spender is an EOA (drainer pattern)
        APPROVE_TO_UNVERIFIED,   // approval to contract with no verified source
        DRAIN_ALL_BALANCE,       // transfer/transferFrom sweeping the full wallet balance
        SET_APPROVAL_FOR_ALL,    // NFT blanket approval (setApprovalForAll)
        UNKNOWN_DELEGATECALL,    // delegatecall to untrusted target
        VALUE_WITHOUT_RECEIVER,  // payable call to a contract that cannot refund (no receive/fallback)
        SUSPICIOUS_DOMAIN,       // ENS name with homoglyph / zero-width / look-alike pattern
        PERMIT_SIG_BROADCAST,    // signed permit observed in public mempool (pre-emptive drain)
        SELFdestruct_TARGET,     // call to a contract with SELFDESTRUCT reachable
        FRESH_CONTRACT,          // target deployed < 72h ago (drainer warm-up window)
        ODD_TOKEN_TAX,           // fee-on-transfer token hidden behind a "0 fee" UI claim
        UNTRUSTED_ROUTER,        // swap routed through non-canonical router
        MULTICALLED_RISK         // aggregate: several medium signals in one tx
    }

    struct Finding {
        RiskKind kind;
        uint8 severity;      // 0 info .. 3 critical
        string label;        // human readable, e.g. "Unlimited approval to 0xabc…"
        address counterparty;
        uint256 exposureWei; // funds at stake (ETH) or 0
    }

    struct Verdict {
        uint8 score;         // 0..100 composite risk
        Finding[] findings;
        string summary;      // one-line verdict for the wallet UI
    }
}
