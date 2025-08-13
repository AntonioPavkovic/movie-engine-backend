## Description

Movie Engine is an app that allows users to lookup, search and rate movies.
the backend is built with NestJS and Pisma as and ORM, PostgreSQL as a DB and OpenSearch for searching capabilities

## Project setup

If you want to start the app you need to have the latest NodeJS LTS and Docker installed.

Once installed, pull the project and run 

```bash
npm install

or 

yarn install
```
and 

```bash
docker-compose up -d
```

which will pull the requirements such as db and opensearch.

Create an .env setup with the following
DATABASE_URL="url"

REDIS_URL=url
WORKER_CONSUMER_GROUP=worker group
STREAM_KEY=stream key

API_KEY = api_key

OPENSEARCH_URL=url
OPENSEARCH_USERNAME=user  
OPENSEARCH_PASSWORD=pass

GOOGLE_CLIENT_ID = clientid
GOOGLE_SECRET = secret
GOOGLE_CALLBACK_URL = callback url

After that run:

```bash
npx prisma generate
```
 - for generating the db schema
 - go to pgadmin and run the .sql scipts provided in the root of the projects (seeders may arrive soon)

 Syncing with OpenSearch service currenly is done manually by making a POST request to the following api endpoing:

```bash
POST {{baseUrl}}/movies/sync/start
```
## DISCLAIMER
- Calculating avg ratings and syncing PostgreSQL and Opensearch are done via Redis Streams.

## Compile and run the project

```bash
$ npm run start:dev
```

## Endpoints and Disclaimer

```bash
X-API-Key
```

Header is required for all the following routes


- Example endpoint for fetching paginated movies or TV shows

```bash
GET {{baseUrl}}/movies/top?type=MOVIE&limit=10&page=0
```

- Example endpoint for fetching a movie or tv show by id

```bash
GET {{baseUrl}}/movies/:id
```

- Example endpoint for rating a movie

```bash
POST {{baseUrl}}/movies/:id

body

{
  "stars": 4
}

```
and the search functionality endpoint is at the following endpoint

```bash
GET {{baseUrl}}/movies/search?query=example
```