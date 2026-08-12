import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";

export type AdminDoc = {
  _id: ObjectId;
  email: string;
  fullName: string;
  passwordHash: string;
  role: "admin";
  createdAt: Date;
  updatedAt: Date;
};

export type SessionAdmin = {
  id: string;
  email: string;
  fullName: string;
};

export async function findAdminByEmail(
  email: string,
): Promise<AdminDoc | null> {
  const db = await getDb();
  return db.collection<AdminDoc>("admins").findOne({
    email: email.trim().toLowerCase(),
  });
}
