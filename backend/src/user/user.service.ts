import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { Role } from '../entities/role.entity';
import { ObjectId } from 'mongodb';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Role)
    private roleRepository: Repository<Role>,
  ) {}

  async findById(id: string): Promise<User> {
    try {
      if (!id) {
        throw new NotFoundException('User ID is required');
      }

      // Handle both string ID and ObjectId
      let objectId: ObjectId;
      try {
        objectId = new ObjectId(id);
      } catch (error: any) {
        console.error('UserService.findById - Invalid ObjectId format:', id, error.message);
        throw new NotFoundException(`Invalid user ID format: ${id}`);
      }

      const user = await this.userRepository.findOne({
        where: { _id: objectId } as any,
      });
      
      if (!user) {
        console.error('UserService.findById - User not found in database for ID:', id);
        throw new NotFoundException(`User not found with ID: ${id}`);
      }
      
      // Ensure id is accessible as string - handle both _id and id properties
      const userId = (user as any)._id;
      if (userId) {
        (user as any).id = userId.toString();
        // Also keep _id for MongoDB compatibility
        (user as any)._id = userId;
      } else if ((user as any).id) {
        // If id exists, ensure it's a string
        (user as any).id = (user as any).id.toString();
      }
      
      return user;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      console.error('UserService.findById - Unexpected error:', error);
      throw new NotFoundException(`User lookup failed: ${error.message}`);
    }
  }

  async findByEmail(email: string): Promise<User | null> {
    const user = await this.userRepository.findOne({ where: { email } });
    if (user) {
      // Ensure id is accessible
      const userId = (user as any)._id;
      if (userId) {
        (user as any).id = userId.toString();
      }
    }
    return user;
  }

  async updateProfile(userId: string, updateData: Partial<User>): Promise<User> {
    const user = await this.findById(userId);
    Object.assign(user, updateData);
    return this.userRepository.save(user);
  }

  async getUserRole(roleId: string): Promise<Role> {
    const role = await this.roleRepository.findOne({
      where: { _id: new ObjectId(roleId) } as any,
    });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    (role as any).id = (role as any)._id?.toString() || (role as any).id?.toString();
    return role;
  }
}

