import { z } from "zod";

import { authedService, publicService } from "@/lib/service";
import { db } from "@/lib/db";
import { Prisma, PrismaClient } from "@prisma/client";

/**
 * experimenting with upsertMany function
 * this should not be used in any production apps
 */

const formatValuesList = <T extends object>(rows: T[]): Prisma.Sql => {
  return Prisma.join(
    rows.map(
      (row) =>
        Prisma.sql`(${Prisma.join(
          Object.values(row).map((value) => {
            if (value instanceof Date) {
              return Prisma.sql`${value.toISOString()}`;
            } else if (typeof value === "string") {
              return Prisma.sql`'${value}'`;
            } else {
              return Prisma.sql`${value}`;
            }
          }),
          ",",
        )})`,
    ),
    ",\n",
  );
};

export const upsertMany = async <T extends object>(
  db: PrismaClient,
  options: {
    tableName: Prisma.ModelName;
    primaryKey?: keyof T;
    values: T[];
  },
) => {
  const { tableName, primaryKey = "id", values } = options;

  if (values.length === 0) {
    return;
  }

  const item1 = values[0];
  if (!item1) return;

  const columns = Object.keys(item1) as (keyof T)[];

  const insertQuery = Prisma.sql`
    INSERT INTO ${Prisma.raw(tableName)} (${Prisma.join(
      columns.map((x) => Prisma.raw(x.toString())),
      ", ",
    )})
    VALUES ${formatValuesList(values)}
    ON CONFLICT (${Prisma.raw(primaryKey as string)}) DO NOTHING;
  `;

  const updateQueries = values.map((value) => {
    const updateColumns = columns.filter((column) => column !== primaryKey);
    const updateValues = updateColumns.map((column) =>
      Prisma.raw(`${column.toString()} = ${Prisma.raw(value[column] as any)}`),
    );

    return Prisma.sql`
      UPDATE ${Prisma.raw(tableName)}
      SET ${Prisma.join(updateValues, ", ")}
      WHERE ${Prisma.raw(primaryKey as string)} = ${value[primaryKey as keyof T]};
    `;
  });

  await db.$transaction([
    db.$queryRaw(insertQuery),
    ...updateQueries.map((query) => db.$queryRaw(query)),
  ]);
};

// THIS SHOULD WORK WELL FOR POSTGRES, only issue is that this demo contains sqlite
// export const upsertMany = async <T extends object>(
//   db: PrismaClient,
//   options: {
//     tableName: Prisma.ModelName;
//     primaryKey?: keyof T;
//     values: T[];
//   },
// ) => {
//   const { tableName, primaryKey = "id", values } = options;

//   if (values.length === 0) {
//     return;
//   }

//   const item1 = values[0];
//   if (!item1) return;

//   const columns = Object.keys(item1 as (keyof T)[]);

//   const query = Prisma.sql`
//     INSERT INTO ${Prisma.raw(tableName)} (${Prisma.join(columns.map(Prisma.raw), ", ")})
//     VALUES ${formatValuesList(values)}
//     ON DUPLICATE KEY UPDATE
//       ${Prisma.join(
//         columns
//           .filter((column) => column !== primaryKey)
//           .map(
//             (column) =>
//               Prisma.sql`${Prisma.raw(column)} = VALUES(${Prisma.raw(column)})`,
//           ),
//         ",\n",
//       )};
//   `;

//   return db.$queryRaw(query);
// };
