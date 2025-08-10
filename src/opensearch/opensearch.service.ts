import { Injectable } from "@nestjs/common";
import { Client } from '@opensearch-project/opensearch';

@Injectable()
export class OpenSearchService {
    client: Client;

    index = process.env.OPENSEARCH_INDEX || 'movies';

  constructor() {
    const node = process.env.OPENSEARCH_NODE || 'http://localhost:9200';
    const username = process.env.OPENSEARCH_USERNAME;
    const password = process.env.OPENSEARCH_PASSWORD;

    const auth = username && password ? { username, password } : undefined;

    this.client = new Client({ node, auth });
  }

  async indexMovieDoc(id: number, body: any) {
    return this.client.index({
        index: this.index,
        id: String(id),
        body,
        refresh: "wait_for"
    });
  }

  async bulkIndex(actions: any[]) {
    return this.client.bulk({ refresh: true, body: actions });
  }

  
  async createIndexIfNotExists(mapping: any) {
    const exists = await this.client.indices.exists({ index: this.index });
    if (!exists.body) {
      await this.client.indices.create({
        index: this.index,
        body: mapping,
      });
    }
  }
}