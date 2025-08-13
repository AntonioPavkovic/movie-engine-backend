import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from 'prisma/prisma.service';


@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async validateGoogleUser(googleUser: {
    googleId: string;
    email: string;
    name: string;
    picture: string;
  }) {
    const existingUser = await this.prisma.user.findUnique({
      where: { googleId: googleUser.googleId },
    });

    if (existingUser) {
      return existingUser;
    }

    // Create new user
    const newUser = await this.prisma.user.create({
      data: {
        googleId: googleUser.googleId,
        email: googleUser.email,
        name: googleUser.name,
        picture: googleUser.picture,
      },
    });

    return newUser;
  }

  async generateJwtToken(user: any) {
    const payload = { 
      sub: user.id, 
      email: user.email,
      name: user.name 
    };
    return this.jwtService.sign(payload);
  }
}