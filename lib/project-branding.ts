import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";

export async function getProjectBranding(projectId: ObjectId) {
  const db = await getDb();
  const project = await db.collection<{ name?: string; logoUrl?: string }>("projects").findOne(
    { _id: projectId },
    { projection: { name: 1, logoUrl: 1 } },
  );
  return {
    name: project?.name?.trim() || "",
    logoUrl: project?.logoUrl?.trim() || "",
  };
}
