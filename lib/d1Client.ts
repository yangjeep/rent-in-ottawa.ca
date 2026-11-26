/**
 * Cloudflare D1 HTTP API Client
 * 
 * Queries D1 database using Cloudflare's REST API.
 * Supports both database ID and database name (resolves name to ID).
 */

interface D1QueryResult {
  success: boolean;
  meta: {
    changed_db: boolean;
    changes: number;
    duration: number;
    last_row_id: number;
    rows_read: number;
    rows_written: number;
    size_after: number;
  };
  results: any[];
}

interface D1Database {
  uuid: string;
  name: string;
  created_at: string;
  version: string;
}

interface D1ListDatabasesResponse {
  success: boolean;
  result: D1Database[];
}

class D1Client {
  private accountId: string;
  private apiToken: string;
  private databaseId: string | null = null;
  private databaseName: string;

  constructor() {
    this.accountId = process.env.CLOUDFLARE_ACCOUNT_ID || "";
    this.apiToken = process.env.CLOUDFLARE_API_TOKEN || "";
    this.databaseName = process.env.D1_DATABASE_NAME || "rio-baserow-core";

    if (!this.accountId) {
      throw new Error("CLOUDFLARE_ACCOUNT_ID is required");
    }
    if (!this.apiToken) {
      throw new Error("CLOUDFLARE_API_TOKEN is required");
    }
  }

  /**
   * Resolve database ID from name by listing all databases
   */
  private async resolveDatabaseId(): Promise<string> {
    if (this.databaseId) {
      return this.databaseId;
    }

    try {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/d1/database`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to list D1 databases: ${response.status} ${errorText}`
        );
      }

      const data: D1ListDatabasesResponse = await response.json();

      if (!data.success) {
        throw new Error("Failed to list D1 databases: API returned success=false");
      }

      const database = data.result.find((db) => db.name === this.databaseName);

      if (!database) {
        throw new Error(
          `D1 database "${this.databaseName}" not found. Available databases: ${data.result.map((db) => db.name).join(", ")}`
        );
      }

      this.databaseId = database.uuid;
      return this.databaseId;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to resolve D1 database ID: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Execute a SQL query against D1 database
   */
  async query(sql: string, params: any[] = []): Promise<D1QueryResult> {
    const databaseId = await this.resolveDatabaseId();

    try {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/d1/database/${databaseId}/query`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sql,
            params,
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `D1 query failed: ${response.status} ${errorText}`
        );
      }

      const data: D1QueryResult = await response.json();

      if (!data.success) {
        throw new Error(`D1 query failed: ${JSON.stringify(data)}`);
      }

      return data;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`D1 query error: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Execute a SELECT query and return results
   */
  async select<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const result = await this.query(sql, params);
    return result.results as T[];
  }

  /**
   * Execute a SELECT query and return first result
   */
  async selectOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const results = await this.select<T>(sql, params);
    return results.length > 0 ? results[0] : null;
  }
}

// Export singleton instance
let d1ClientInstance: D1Client | null = null;

export function getD1Client(): D1Client {
  if (!d1ClientInstance) {
    d1ClientInstance = new D1Client();
  }
  return d1ClientInstance;
}

// Export types
export type { D1QueryResult, D1Database };

