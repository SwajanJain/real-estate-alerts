import { RealEstateMatcher } from "../core/RealEstateMatcher";

export async function runCli(_argv: string[]): Promise<void> {
  new RealEstateMatcher().execute();
}
