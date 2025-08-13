import { Module } from '@nestjs/common';
import { OpenSearchEngineService } from './opensearch_engine.service';
import { QueryParserService } from './services/query_parser.service';

@Module({
  providers: [OpenSearchEngineService, QueryParserService],
  exports: [OpenSearchEngineService],
})
export class SearchModule {}
