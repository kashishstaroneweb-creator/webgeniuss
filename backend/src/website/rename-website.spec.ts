import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { WebsiteService } from './website.service';
import { RenameWebsiteDto } from './dto/rename-website.dto';

describe('Project renaming', () => {
  const id = new ObjectId();
  const repository = { findOne: jest.fn(), save: jest.fn() };
  const service = Object.create(WebsiteService.prototype) as WebsiteService;
  beforeEach(() => {
    jest.resetAllMocks();
    (service as any).websiteRepository = repository;
  });

  it('renames an owned project without changing its contents', async () => {
    const website = { id, userId: 'owner', websiteName: 'Old', htmlCode: '<main>Keep me</main>' };
    repository.findOne.mockResolvedValue(website);
    await expect(service.renameWebsite(id.toString(), 'owner', '  New name  '))
      .resolves.toEqual({ id: id.toString(), websiteName: 'New name' });
    expect(repository.findOne).toHaveBeenCalledWith({ where: { _id: id, userId: 'owner' } });
    expect(repository.save).toHaveBeenCalledWith({ ...website, websiteName: 'New name', htmlCode: '<main>Keep me</main>' });
  });

  it('does not rename another user\'s project', async () => {
    repository.findOne.mockResolvedValue({ id, userId: 'someone-else' });
    await expect(service.renameWebsite(id.toString(), 'owner', 'New')).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('returns not found for a missing project', async () => {
    repository.findOne.mockResolvedValue(null);
    await expect(service.renameWebsite(id.toString(), 'owner', 'New')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects invalid IDs before querying the database', async () => {
    await expect(service.renameWebsite('invalid', 'owner', 'New')).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.findOne).not.toHaveBeenCalled();
  });

  it.each(['', '   ', 'x'.repeat(101), 123, null])('rejects invalid name %p at the API boundary', async (websiteName) => {
    const dto = plainToInstance(RenameWebsiteDto, { websiteName });
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });
});
