import { z } from 'zod';
import { CATALOG_LIST } from '@flow/core';
import { db, client } from './client';
import { nodeTypes } from './schema';

async function main() {
  for (const def of CATALOG_LIST) {
  const parameterSchema = z.toJSONSchema(def.parameters);
  const outputSchema = z.toJSONSchema(def.output);

  const row = {
    id: def.id,
    version: def.version,
    displayName: def.displayName,
    description: def.description,
    category: def.category,
    outputs: def.outputs,
    parameterSchema,
    outputSchema,
  };

  await db
    .insert(nodeTypes)
    .values(row)
    .onConflictDoUpdate({
      target: [nodeTypes.id, nodeTypes.version],
      set: {
        displayName: row.displayName,
        description: row.description,
        category: row.category,
        outputs: row.outputs,
        parameterSchema: row.parameterSchema,
        outputSchema: row.outputSchema,
      },
    });
}

  console.log(`Seeded ${CATALOG_LIST.length} node definitions.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await client.end();
  });