import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserService } from '../../user/user.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private userService: UserService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'your-secret-key',
    });
  }

  async validate(payload: any) {
    try {
      if (!payload || !payload.sub) {
        console.error('JWT payload missing sub:', payload);
        throw new UnauthorizedException('Invalid token payload');
      }

      let user;
      try {
        user = await this.userService.findById(payload.sub);
      } catch (error: any) {
        // If user not found, log and throw unauthorized
        console.error('User lookup failed:', {
          userId: payload.sub,
          error: error.message,
          errorType: error.constructor.name
        });
        throw new UnauthorizedException(`User not found: ${error.message}`);
      }

      if (!user) {
        console.error('User not found for ID:', payload.sub);
        throw new UnauthorizedException('User not found');
      }
      
      // Extract user ID - handle MongoDB ObjectId format
      const userId = (user as any)._id || (user as any).id;
      if (!userId) {
        console.error('User ID not found in user object:', user);
        throw new UnauthorizedException('Invalid user data');
      }
      
      const userIdString = userId?.toString ? userId.toString() : String(userId);
      
      // Return user object with proper id field
      return {
        ...user,
        id: userIdString,
        _id: userId, // Keep _id for MongoDB compatibility
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      console.error('JWT validation error:', {
        error: error.message,
        stack: error.stack,
        payload: payload
      });
      throw new UnauthorizedException(`Token validation failed: ${error.message}`);
    }
  }
}

