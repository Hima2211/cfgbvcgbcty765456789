import { readFileSync } from 'fs';
import { pool } from './db';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function initializeDatabase() {
  try {
    console.log('🔧 Initializing database schema...');
    
    // Read the migration file
    const migrationPath = path.resolve(__dirname, '../migrations/0000_gray_harrier.sql');
    const sql = readFileSync(migrationPath, 'utf-8');
    
    // Split statements by the drizzle-kit statement separator
    const statements = sql.split('--> statement-breakpoint').filter(s => s.trim());
    
    console.log(`📊 Found ${statements.length} schema statements to execute`);
    
    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i].trim();
      if (!statement) continue;
      
      try {
        const result = await pool.query(statement);
        successCount++;
        if (i < 3 || i === statements.length - 1) {
          console.log(`  ✓ Statement ${i + 1}: ${statement.substring(0, 40).replace(/\n/g, ' ')}...`);
        }
      } catch (error: any) {
        // Ignore "already exists" errors (42P07) and other benign errors
        if (error.code === '42P07' || error.code === '42P06') {
          skipCount++;
        } else if (error.message?.includes('already exists')) {
          skipCount++;
        } else {
          errorCount++;
          console.error(`✗ Statement ${i + 1} FAILED:`, error.message?.substring(0, 100));
          console.error(`   SQL: ${statement.substring(0, 80).replace(/\n/g, ' ')}...`);
        }
      }
    }
    
    console.log(`✅ Database schema initialized: ${successCount} created, ${skipCount} skipped, ${errorCount} warnings`);
    return true;
  } catch (error: any) {
    console.error('❌ Database initialization error:', error.message);
    throw error;
  }
}
