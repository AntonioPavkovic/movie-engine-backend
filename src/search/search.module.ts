import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SearchService } from './search.service';

@Module({
  imports: [ConfigModule],
  providers: [SearchService],
  exports: [SearchService], 
})
export class SearchModule implements OnModuleInit {
  constructor(private searchService: SearchService) {}

  async onModuleInit() {
    await this.searchService.createIndex();
  }
}