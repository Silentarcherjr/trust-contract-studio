import type { ContractView } from "../../../server/domain/service";

export type { ContractView };
export type ObligationView = ContractView["obligations"][number];
export type AttemptView = ContractView["attempts"][number];
export type EvidenceView = ContractView["evidence"][number];
