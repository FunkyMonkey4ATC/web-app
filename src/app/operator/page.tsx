import type { Metadata } from "next";
import Operator from "@/components/operator/Operator";

export const metadata: Metadata = { title: "Operator · Ground Truth" };

export default function OperatorPage() {
  return <Operator />;
}
