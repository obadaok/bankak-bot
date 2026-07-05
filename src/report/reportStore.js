const { ObjectId } = require('mongodb');
const logger = require('../utils/logger');

class ReportStore {
  constructor(collection) {
    this.collection = collection;
  }

  async saveReport({ senderId, startedAt, endedAt, stats }) {
    try {
      const doc = {
        senderId,
        startedAt: new Date(startedAt),
        endedAt: new Date(endedAt),
        totalCount: stats.totalCount,
        totalAmount: stats.totalAmount,
        accounts: stats.accounts,
        createdAt: new Date(),
      };
      const result = await this.collection.insertOne(doc);
      logger.info({ id: result.insertedId, senderId }, 'Report saved to history');
      return result.insertedId;
    } catch (e) {
      logger.error({ err: e.message }, 'Failed to save report to MongoDB');
      return null;
    }
  }

  async listReports({ limit = 20, skip = 0 } = {}) {
    try {
      const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
      const safeSkip = Math.max(parseInt(skip, 10) || 0, 0);

      const [reports, total] = await Promise.all([
        this.collection
          .find({})
          .sort({ endedAt: -1 })
          .skip(safeSkip)
          .limit(safeLimit)
          .toArray(),
        this.collection.countDocuments({}),
      ]);

      return { reports, total };
    } catch (e) {
      logger.error({ err: e.message }, 'Failed to list reports');
      return { reports: [], total: 0 };
    }
  }

  async getReportById(id) {
    try {
      if (!ObjectId.isValid(id)) return null;
      return await this.collection.findOne({ _id: new ObjectId(id) });
    } catch (e) {
      logger.error({ err: e.message }, 'Failed to fetch report by id');
      return null;
    }
  }

  async getAllTimeSummary() {
    try {
      const [agg] = await this.collection
        .aggregate([
          {
            $group: {
              _id: null,
              totalReports: { $sum: 1 },
              totalAmount: { $sum: '$totalAmount' },
              totalOperations: { $sum: '$totalCount' },
            },
          },
        ])
        .toArray();

      return agg
        ? {
            totalReports: agg.totalReports,
            totalAmount: agg.totalAmount,
            totalOperations: agg.totalOperations,
          }
        : { totalReports: 0, totalAmount: 0, totalOperations: 0 };
    } catch (e) {
      logger.error({ err: e.message }, 'Failed to compute all-time summary');
      return { totalReports: 0, totalAmount: 0, totalOperations: 0 };
    }
  }
}

module.exports = ReportStore;
