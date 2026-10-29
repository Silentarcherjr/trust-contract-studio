import { useParams } from "react-router";

import { ContractWorkspace } from "@/components/studio/ContractWorkspace";

export function meta() {
  return [{ title: "Contract · Trust Contract Studio" }];
}

export default function StudioContractRoute() {
  const { contractId = "" } = useParams();
  return (
    <div className="tcs h-full overflow-y-auto">
      <ContractWorkspace key={contractId} contractId={contractId} />
    </div>
  );
}
