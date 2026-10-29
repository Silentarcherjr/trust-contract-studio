import { StudioHome } from "@/components/studio/StudioHome";

export function meta() {
  return [{ title: "Trust Contract Studio" }];
}

export default function StudioIndexRoute() {
  return (
    <div className="tcs h-full overflow-y-auto">
      <StudioHome />
    </div>
  );
}
