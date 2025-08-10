// worker.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { RedisService } from './redis.service';

@Injectable()
export class RatingWorkerService {
  constructor(
    private redisService: RedisService,
    private prisma: PrismaService,
  ) {}

  async onModuleInit() {
    this.startRatingStreamConsumer();
  }

  async startRatingStreamConsumer() {
    const streamKey = process.env.STREAM_KEY || 'ratings:stream';
    const consumerGroup = 'rating_workers';
    const consumerId = `worker_${process.pid}`; // Unique ID for this worker instance

    // Create the consumer group if it doesn't exist
    try {
      await this.redisService.client.xgroup('CREATE', streamKey, consumerGroup, '$', 'MKSTREAM');
    } catch (error) {
      // Ignore the error if the consumer group already exists
      if (error.message.includes('BUSYGROUP')) {
        console.log(`Consumer group '${consumerGroup}' already exists.`);
      } else {
        console.error('Error creating consumer group:', error);
      }
    }

    console.log(`Starting Redis stream consumer '${consumerId}' for group '${consumerGroup}'...`);

    while (true) {
      try {
        // Read from the stream. 'BLOCK 1000' means wait for 1 second if no new messages.
        const result = await this.redisService.client.xreadgroup(
          'GROUP', consumerGroup, consumerId,
          'BLOCK', 1000,
          'COUNT', 10, // Process up to 10 messages at a time
          'STREAMS', streamKey, '>'
        );

        if (result && result.length > 0) {
          for (const stream of result) {
            const messages = stream[1]; // Get the messages from the stream
            for (const message of messages) {
              const messageId = message[0];
              const data = Object.fromEntries(new Map(
                message[1].map((field, index, array) => (index % 2 === 0 ? [field, array[index + 1]] : null)).filter(Boolean)
              ));
              
              // Process the message
              await this.processRating(data);
              
              // Acknowledge the message to remove it from the pending entries list
              await this.redisService.client.xack(streamKey, consumerGroup, messageId);
            }
          }
        }
      } catch (error) {
        console.error('Error reading from Redis stream:', error);
      }
    }
  }

  async processRating(ratingData: any) {
    const { movieId, stars } = ratingData;
    const movieIdNum = Number(movieId);
    const starsNum = Number(stars);

    // This is the core logic: get the current movie state and update it.
    try {
      const movie = await this.prisma.movie.findUnique({
        where: { id: movieIdNum },
      });

      if (movie) {
        // Recalculate the average rating
        const newRatingsCount = movie.ratingsCount + 1;
        const totalRatingSum = (movie.avgRating * movie.ratingsCount) + starsNum;
        const newAvgRating = totalRatingSum / newRatingsCount;

        // Update the movie in the database
        await this.prisma.movie.update({
          where: { id: movieIdNum },
          data: {
            avgRating: parseFloat(newAvgRating.toFixed(2)),
            ratingsCount: newRatingsCount,
            updatedAt: new Date(),
          },
        });
        
        // After the DB update, trigger a re-index of the movie
        await this.indexMovie(movieIdNum);
      }
    } catch (error) {
      console.error(`Error processing rating for movie ${movieId}:`, error);
    }
  }
  
  // NOTE: You would need to move your `indexMovie` logic here or call a separate service.
  async indexMovie(movieId: number) {
    // This part should be identical to the one in your original code.
    // ... code to fetch movie and index it in OpenSearch ...
  }
}