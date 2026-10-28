import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";

/** Distinct companies (accounts) per list for a project. */
export async function getDistinctCompanyCountsByList(
  projectId: ObjectId,
): Promise<Map<string, number>> {
  const db = await getDb();
  const rows = await db
    .collection("list_memberships")
    .aggregate<{ _id: ObjectId; companyCount: number }>([
      { $match: { projectId } },
      {
        $lookup: {
          from: "contacts",
          localField: "contactId",
          foreignField: "_id",
          as: "contact",
        },
      },
      { $unwind: "$contact" },
      { $match: { "contact.companyId": { $ne: null } } },
      {
        $group: {
          _id: { listId: "$listId", companyId: "$contact.companyId" },
        },
      },
      {
        $group: {
          _id: "$_id.listId",
          companyCount: { $sum: 1 },
        },
      },
    ])
    .toArray();

  return new Map(rows.map((row) => [row._id.toString(), row.companyCount]));
}

export async function countDistinctCompaniesForList(
  projectId: ObjectId,
  listId: ObjectId,
): Promise<number> {
  const db = await getDb();
  const rows = await db
    .collection("list_memberships")
    .aggregate<{ n: number }>([
      { $match: { projectId, listId } },
      {
        $lookup: {
          from: "contacts",
          localField: "contactId",
          foreignField: "_id",
          as: "contact",
        },
      },
      { $unwind: "$contact" },
      { $match: { "contact.companyId": { $ne: null } } },
      { $group: { _id: "$contact.companyId" } },
      { $count: "n" },
    ])
    .toArray();
  return rows[0]?.n ?? 0;
}
